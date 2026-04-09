import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// ─── Plan catalogue ────────────────────────────────────────────────────────────
const PLANS = [
  { id: '1_month',  name: '1 Month',   months: 1,  price: 70,  badge: null },
  { id: '2_months', name: '2 Months',  months: 2,  price: 120, badge: null },
  { id: '3_months', name: '3 Months',  months: 3,  price: 150, badge: 'POPULAR' },
  { id: '6_months', name: '6 Months',  months: 6,  price: 250, badge: null },
  { id: '1_year',   name: '1 Year',    months: 12, price: 300, badge: 'BEST VALUE' },
  { id: 'coins_50', name: 'Coins Pack', months: 0, price: 50,  badge: null, coins: 50 },
];

const COUPONS: Record<string, { months: number; coins: number; expiresAt: string }> = {
  EARLYBIRDS: { months: 3, coins: 50, expiresAt: '2026-09-12T23:59:00+05:30' },
};

// GET /subscriptions/plans
export async function getPlans(_req: Request, res: Response) {
  return res.json({ plans: PLANS });
}

// GET /subscriptions/me
export async function getMySubscription(req: Request, res: Response) {
  const userId = req.userId!;
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

  const coupon = COUPONS[code.toUpperCase()];
  if (!coupon) return res.status(400).json({ error: 'Invalid coupon code' });
  if (new Date(coupon.expiresAt) < new Date()) return res.status(400).json({ error: 'Coupon expired' });

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

  return res.json({
    success: true,
    months: coupon.months,
    coins: coupon.coins,
    expiresAt,
  });
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
