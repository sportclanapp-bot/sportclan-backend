import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sendPushToTokens } from '../utils/fcm';

// ─── Expiry auto-checker ──────────────────────────────────────────────────────
// Runs on every hit to /users/me and /subscriptions/me so there's no cron
// dependency. Cheap because it only scans the current user's rows.
//
// 1. If an active subscription's expires_at has passed, mark the subscription
//    expired AND clear is_premium / premium_expires_at on the user.
// 2. If premium expires in <= 3 days, insert a one-per-day notification and
//    fire a push. Throttled by users.last_premium_reminder_at so we don't spam
//    on every GET.
export async function checkExpiredSubscriptions(userId: string): Promise<void> {
  const nowIso = new Date().toISOString();

  // 1. Expire lapsed active subscriptions for this user.
  const { data: lapsed } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .lt('expires_at', nowIso);

  if (lapsed && lapsed.length > 0) {
    await supabase
      .from('subscriptions')
      .update({ status: 'expired', updated_at: nowIso })
      .in('id', lapsed.map((s) => s.id));

    await supabase
      .from('users')
      .update({ is_premium: false, premium_expires_at: null })
      .eq('id', userId);

    // Insert in-app notification + push.
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'premium_expired',
      title: 'Premium expired',
      body: 'Your Premium plan has expired. Renew now!',
      data: { screen: 'SubscriptionScreen' },
    });

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId);
    if (tokens && tokens.length > 0) {
      await sendPushToTokens(
        tokens.map((t) => t.token),
        {
          title: 'Premium expired',
          body: 'Your Premium plan has expired. Renew now!',
          data: { type: 'premium_expired', screen: 'SubscriptionScreen' },
        },
      );
    }
    return;
  }

  // 2. Warn 3 days before expiry, throttled to once per day.
  const { data: user } = await supabase
    .from('users')
    .select('is_premium, premium_expires_at, last_premium_reminder_at')
    .eq('id', userId)
    .maybeSingle();

  if (!user?.is_premium || !user.premium_expires_at) return;

  const expiresAt = new Date(user.premium_expires_at).getTime();
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((expiresAt - now) / msPerDay);
  if (daysLeft > 3 || daysLeft < 0) return;

  // Already reminded today?
  if (user.last_premium_reminder_at) {
    const lastRemind = new Date(user.last_premium_reminder_at).getTime();
    if (now - lastRemind < msPerDay) return;
  }

  await supabase
    .from('users')
    .update({ last_premium_reminder_at: new Date().toISOString() })
    .eq('id', userId);

  const body = `Your Premium expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renew now!`;
  await supabase.from('notifications').insert({
    user_id: userId,
    type: 'premium_expiring',
    title: 'Premium expiring soon',
    body,
    data: { screen: 'SubscriptionScreen', daysLeft: String(daysLeft) },
  });

  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId);
  if (tokens && tokens.length > 0) {
    await sendPushToTokens(
      tokens.map((t) => t.token),
      {
        title: 'Premium expiring soon',
        body,
        data: { type: 'premium_expiring', screen: 'SubscriptionScreen' },
      },
    );
  }
}

// ─── Scheduled bulk expiry sweep ────────────────────────────────────────────────
// checkExpiredSubscriptions() above only runs lazily (on /users/me &
// /subscriptions/me), so a user who never opens the app would keep is_premium=true
// past expiry — and others would still see them as premium in search/services.
// This sweep flips ALL lapsed users in one pass and is run on an interval from
// the server bootstrap (see src/index.ts). Idempotent + safe to run repeatedly.
//
// NOTE: only matches rows with a non-null premium_expires_at in the past, so
// permanent-premium accounts (null expiry, e.g. admin-granted) are never touched.
export async function sweepExpiredPremium(): Promise<{ users: number; subs: number }> {
  const nowIso = new Date().toISOString();

  // 1. Mark lapsed active subscriptions expired.
  const { data: lapsedSubs } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('status', 'active')
    .lt('expires_at', nowIso);
  if (lapsedSubs && lapsedSubs.length > 0) {
    await supabase
      .from('subscriptions')
      .update({ status: 'expired', updated_at: nowIso })
      .in('id', lapsedSubs.map((s) => s.id));
  }

  // 2. Drop lapsed users to free tier.
  const { data: lapsedUsers } = await supabase
    .from('users')
    .select('id')
    .eq('is_premium', true)
    .not('premium_expires_at', 'is', null)
    .lt('premium_expires_at', nowIso);
  if (lapsedUsers && lapsedUsers.length > 0) {
    await supabase
      .from('users')
      .update({ is_premium: false, premium_expires_at: null })
      .in('id', lapsedUsers.map((u) => u.id));
  }

  return { users: lapsedUsers?.length ?? 0, subs: lapsedSubs?.length ?? 0 };
}

// ─── Plan catalogue ────────────────────────────────────────────────────────────
const PLANS = [
  { id: '1_month',  name: '1 Month',   months: 1,  price: 70,  badge: null },
  { id: '2_months', name: '2 Months',  months: 2,  price: 120, badge: null },
  { id: '3_months', name: '3 Months',  months: 3,  price: 150, badge: 'POPULAR' },
  { id: '6_months', name: '6 Months',  months: 6,  price: 250, badge: null },
  { id: '1_year',   name: '1 Year',    months: 12, price: 300, badge: 'BEST VALUE' },
  { id: 'coins_50', name: 'Coins Pack', months: 0, price: 50,  badge: null, coins: 50 },
];

// Hard-coded coupon fallbacks. EARLYBIRDS was retired at launch — every new
// signup now auto-receives 3 months Premium + 50 coins via the early-bird grant
// in auth.controller (so the coupon would double-grant). The DB coupon_codes row
// is also deactivated (see APPLY-retire-earlybirds.sql). Empty by design; the
// coupon_codes table remains the source of truth for any future codes.
const COUPONS: Record<string, { months: number; coins: number; expiresAt: string }> = {};

// GET /subscriptions/plans
export async function getPlans(_req: Request, res: Response) {
  return res.json({ plans: PLANS });
}

// GET /subscriptions/me
export async function getMySubscription(req: Request, res: Response) {
  const userId = req.userId!;
  // Lazy-expire any lapsed subscription for this user before we return state.
  await checkExpiredSubscriptions(userId);
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: user } = await supabase
    .from('users')
    .select('coin_balance, is_premium, premium_expires_at')
    .eq('id', userId)
    .single();

  return res.json({ subscription: data, coinBalance: user?.coin_balance ?? 0, isPremium: user?.is_premium ?? false, premiumExpiresAt: user?.premium_expires_at });
}

// POST /subscriptions/initiate  { planId }
export async function initiate(req: Request, res: Response) {
  const userId = req.userId!;
  const { planId } = req.body || {};
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });

  // Create a pending subscription record
  const expiresAt = plan.months > 0
    ? new Date(Date.now() + plan.months * 30 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { data: sub, error } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan_id: planId,
      status: 'pending',
      amount_inr: plan.price,
      payment_provider: 'razorpay',
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // In production, create Razorpay order here. For now return mock order.
  return res.json({
    subscriptionId: sub.id,
    razorpayOrderId: `order_mock_${sub.id.slice(0, 8)}`,
    amount: plan.price * 100, // paise
    currency: 'INR',
    planName: plan.name,
  });
}

// POST /subscriptions/verify  { subscriptionId, razorpayPaymentId, razorpayOrderId, razorpaySignature }
export async function verify(req: Request, res: Response) {
  const userId = req.userId!;
  const { subscriptionId, razorpayPaymentId, razorpayOrderId } = req.body || {};

  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId required' });

  // In production, verify Razorpay signature here.
  // For now, activate the subscription directly.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('id', subscriptionId)
    .eq('user_id', userId)
    .single();

  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  const plan = PLANS.find((p) => p.id === sub.plan_id);

  // Activate subscription
  await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      provider_payment_id: razorpayPaymentId || 'mock_payment',
      provider_order_id: razorpayOrderId || 'mock_order',
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);

  // If coins pack, add coins; otherwise activate premium
  if (sub.plan_id === 'coins_50') {
    const { data: usr } = await supabase.from('users').select('coin_balance').eq('id', userId).single();
    await supabase.from('users').update({ coin_balance: (usr?.coin_balance ?? 0) + 50 }).eq('id', userId);
  } else {
    await supabase.from('users').update({
      is_premium: true,
      premium_expires_at: sub.expires_at,
    }).eq('id', userId);
  }

  // Record transaction
  await supabase.from('transactions').insert({
    user_id: userId,
    type: sub.plan_id === 'coins_50' ? 'coins' : 'subscription',
    amount_inr: sub.amount_inr,
    coins: sub.plan_id === 'coins_50' ? 50 : 0,
    description: `${plan?.name ?? sub.plan_id} purchase`,
    reference_id: razorpayPaymentId || 'mock_payment',
    status: 'completed',
  });

  return res.json({ success: true, message: 'Payment verified and subscription activated' });
}

// POST /subscriptions/apple/verify  { receipt, planId }
export async function appleVerify(req: Request, res: Response) {
  const userId = req.userId!;
  const { planId } = req.body || {};
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });

  // In production, verify Apple receipt with App Store. For now, auto-activate.
  const expiresAt = plan.months > 0
    ? new Date(Date.now() + plan.months * 30 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { data: sub } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan_id: planId,
      status: 'active',
      amount_inr: plan.price,
      payment_provider: 'apple',
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (plan.id === 'coins_50') {
    const { data: usr } = await supabase.from('users').select('coin_balance').eq('id', userId).single();
    await supabase.from('users').update({ coin_balance: (usr?.coin_balance ?? 0) + 50 }).eq('id', userId);
  } else {
    await supabase.from('users').update({
      is_premium: true,
      premium_expires_at: expiresAt,
    }).eq('id', userId);
  }

  await supabase.from('transactions').insert({
    user_id: userId,
    type: plan.id === 'coins_50' ? 'coins' : 'subscription',
    amount_inr: plan.price,
    coins: plan.id === 'coins_50' ? 50 : 0,
    description: `${plan.name} purchase (Apple)`,
    reference_id: sub?.id ?? 'apple',
    status: 'completed',
  });

  return res.json({ success: true });
}

// POST /subscriptions/coupon  { code }
export async function redeemCoupon(req: Request, res: Response) {
  const userId = req.userId!;
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code required' });

  // Prefer the coupon_codes table (single source of truth). Fall back to the
  // hard-coded map so existing deployments keep working if the table lookup
  // fails for any reason. Production schema (verified 2026-04-11):
  //   id, code, description, premium_months, coins, max_uses (nullable),
  //   uses_count, expires_at, active, created_at.
  const upperCode = code.toUpperCase();
  let months = 0;
  let coins = 0;
  let couponExpiry: Date | null = null;
  let couponDbId: string | null = null;

  const { data: couponRow } = await supabase
    .from('coupon_codes')
    .select('id, code, premium_months, coins, expires_at, max_uses, uses_count, active')
    .eq('code', upperCode)
    .maybeSingle();

  if (couponRow) {
    if (couponRow.active === false) {
      return res.status(400).json({ error: 'Coupon is disabled' });
    }
    // max_uses is nullable — null means unlimited.
    if (
      couponRow.max_uses != null &&
      couponRow.max_uses > 0 &&
      (couponRow.uses_count ?? 0) >= couponRow.max_uses
    ) {
      return res.status(400).json({ error: 'Coupon fully redeemed' });
    }
    months = couponRow.premium_months ?? 0;
    coins = couponRow.coins ?? 0;
    couponExpiry = couponRow.expires_at ? new Date(couponRow.expires_at) : null;
    couponDbId = couponRow.id;
  } else {
    const legacy = COUPONS[upperCode];
    if (!legacy) return res.status(400).json({ error: 'Invalid coupon code' });
    months = legacy.months;
    coins = legacy.coins;
    couponExpiry = new Date(legacy.expiresAt);
  }

  if (couponExpiry && couponExpiry < new Date()) {
    return res.status(400).json({ error: 'Coupon expired' });
  }
  const coupon = { months, coins };

  // Check if already used
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('coupon_code', code.toUpperCase())
    .limit(1)
    .maybeSingle();

  if (existing) return res.status(400).json({ error: 'Coupon already used' });

  const expiresAt = new Date(Date.now() + coupon.months * 30 * 24 * 60 * 60 * 1000).toISOString();

  // Create subscription
  await supabase.from('subscriptions').insert({
    user_id: userId,
    plan_id: `coupon_${code.toUpperCase()}`,
    status: 'active',
    amount_inr: 0,
    payment_provider: 'coupon',
    coupon_code: code.toUpperCase(),
    expires_at: expiresAt,
  });

  // Activate premium + add coins
  const { data: usr } = await supabase.from('users').select('coin_balance').eq('id', userId).single();
  await supabase.from('users').update({
    is_premium: true,
    premium_expires_at: expiresAt,
    coin_balance: (usr?.coin_balance ?? 0) + coupon.coins,
  }).eq('id', userId);

  // Record transaction
  await supabase.from('transactions').insert({
    user_id: userId,
    type: 'coupon',
    amount_inr: 0,
    coins: coupon.coins,
    description: `Coupon: ${code.toUpperCase()} — ${coupon.months} months + ${coupon.coins} coins`,
    reference_id: code.toUpperCase(),
    status: 'completed',
  });

  // Bump uses_count so we honour max_uses on the next redemption. Best-effort.
  if (couponDbId) {
    const { data: fresh } = await supabase
      .from('coupon_codes')
      .select('uses_count')
      .eq('id', couponDbId)
      .maybeSingle();
    if (fresh) {
      await supabase
        .from('coupon_codes')
        .update({ uses_count: (fresh.uses_count ?? 0) + 1 })
        .eq('id', couponDbId);
    }
  }

  return res.json({
    success: true,
    months: coupon.months,
    coins: coupon.coins,
    expiresAt,
  });
}

// POST /subscriptions/trial — one-time 7-day Premium trial.
// Requires trial_used=false. Flips is_premium=true, sets premium_expires_at
// to now+7 days, marks trial_used=true, and inserts a dummy subscription
// row with amount=0 so transactions/history stay consistent.
export async function startTrial(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { data: usr } = await supabase
    .from('users')
    .select('trial_used, is_premium')
    .eq('id', userId)
    .maybeSingle();
  if (!usr) return res.status(404).json({ error: 'User not found' });
  if (usr.trial_used) return res.status(400).json({ error: 'Trial already used' });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: updErr } = await supabase
    .from('users')
    .update({
      is_premium: true,
      premium_expires_at: expiresAt,
      trial_used: true,
    })
    .eq('id', userId);
  if (updErr) return res.status(500).json({ error: updErr.message });

  // Create a trial subscription record.
  await supabase.from('subscriptions').insert({
    user_id: userId,
    plan_id: 'trial',
    status: 'active',
    amount_inr: 0,
    payment_provider: 'trial',
    expires_at: expiresAt,
  });

  // Best-effort push.
  try {
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId);
    if (tokens && tokens.length > 0) {
      await sendPushToTokens(
        tokens.map((t) => t.token),
        {
          title: '\uD83C\uDF89 Premium trial started',
          body: 'You\u2019ve got 7 days of SportClan Premium. Enjoy!',
          data: { type: 'trial_started', screen: 'SubscriptionScreen' },
        },
      );
    }
  } catch {
    // swallow
  }

  return res.json({ success: true, trialEndsAt: expiresAt });
}

// POST /subscriptions/cancel
export async function cancel(req: Request, res: Response) {
  const userId = req.userId!;

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub) return res.status(404).json({ error: 'No active subscription' });

  await supabase.from('subscriptions').update({
    auto_renew: false,
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id);

  return res.json({ success: true, message: 'Auto-renew disabled. Subscription active until expiry.' });
}
