"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancel = exports.redeemCoupon = exports.appleVerify = exports.verify = exports.initiate = exports.getMySubscription = exports.getPlans = exports.checkExpiredSubscriptions = void 0;
const supabase_1 = require("../utils/supabase");
const fcm_1 = require("../utils/fcm");
// ─── Expiry auto-checker ──────────────────────────────────────────────────────
// Runs on every hit to /users/me and /subscriptions/me so there's no cron
// dependency. Cheap because it only scans the current user's rows.
//
// 1. If an active subscription's expires_at has passed, mark the subscription
//    expired AND clear is_premium / premium_expires_at on the user.
// 2. If premium expires in <= 3 days, insert a one-per-day notification and
//    fire a push. Throttled by users.last_premium_reminder_at so we don't spam
//    on every GET.
async function checkExpiredSubscriptions(userId) {
    const nowIso = new Date().toISOString();
    // 1. Expire lapsed active subscriptions for this user.
    const { data: lapsed } = await supabase_1.supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .lt('expires_at', nowIso);
    if (lapsed && lapsed.length > 0) {
        await supabase_1.supabase
            .from('subscriptions')
            .update({ status: 'expired', updated_at: nowIso })
            .in('id', lapsed.map((s) => s.id));
        await supabase_1.supabase
            .from('users')
            .update({ is_premium: false, premium_expires_at: null })
            .eq('id', userId);
        // Insert in-app notification + push.
        await supabase_1.supabase.from('notifications').insert({
            user_id: userId,
            type: 'premium_expired',
            title: 'Premium expired',
            body: 'Your Premium plan has expired. Renew now!',
            data: { screen: 'SubscriptionScreen' },
        });
        const { data: tokens } = await supabase_1.supabase
            .from('push_tokens')
            .select('token')
            .eq('user_id', userId);
        if (tokens && tokens.length > 0) {
            await (0, fcm_1.sendPushToTokens)(tokens.map((t) => t.token), {
                title: 'Premium expired',
                body: 'Your Premium plan has expired. Renew now!',
                data: { type: 'premium_expired', screen: 'SubscriptionScreen' },
            });
        }
        return;
    }
    // 2. Warn 3 days before expiry, throttled to once per day.
    const { data: user } = await supabase_1.supabase
        .from('users')
        .select('is_premium, premium_expires_at, last_premium_reminder_at')
        .eq('id', userId)
        .maybeSingle();
    if (!user?.is_premium || !user.premium_expires_at)
        return;
    const expiresAt = new Date(user.premium_expires_at).getTime();
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysLeft = Math.ceil((expiresAt - now) / msPerDay);
    if (daysLeft > 3 || daysLeft < 0)
        return;
    // Already reminded today?
    if (user.last_premium_reminder_at) {
        const lastRemind = new Date(user.last_premium_reminder_at).getTime();
        if (now - lastRemind < msPerDay)
            return;
    }
    await supabase_1.supabase
        .from('users')
        .update({ last_premium_reminder_at: new Date().toISOString() })
        .eq('id', userId);
    const body = `Your Premium expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renew now!`;
    await supabase_1.supabase.from('notifications').insert({
        user_id: userId,
        type: 'premium_expiring',
        title: 'Premium expiring soon',
        body,
        data: { screen: 'SubscriptionScreen', daysLeft: String(daysLeft) },
    });
    const { data: tokens } = await supabase_1.supabase
        .from('push_tokens')
        .select('token')
        .eq('user_id', userId);
    if (tokens && tokens.length > 0) {
        await (0, fcm_1.sendPushToTokens)(tokens.map((t) => t.token), {
            title: 'Premium expiring soon',
            body,
            data: { type: 'premium_expiring', screen: 'SubscriptionScreen' },
        });
    }
}
exports.checkExpiredSubscriptions = checkExpiredSubscriptions;
// ─── Plan catalogue ────────────────────────────────────────────────────────────
const PLANS = [
    { id: '1_month', name: '1 Month', months: 1, price: 70, badge: null },
    { id: '2_months', name: '2 Months', months: 2, price: 120, badge: null },
    { id: '3_months', name: '3 Months', months: 3, price: 150, badge: 'POPULAR' },
    { id: '6_months', name: '6 Months', months: 6, price: 250, badge: null },
    { id: '1_year', name: '1 Year', months: 12, price: 300, badge: 'BEST VALUE' },
    { id: 'coins_50', name: 'Coins Pack', months: 0, price: 50, badge: null, coins: 50 },
];
const COUPONS = {
    EARLYBIRDS: { months: 3, coins: 50, expiresAt: '2026-09-12T23:59:00+05:30' },
};
// GET /subscriptions/plans
async function getPlans(_req, res) {
    return res.json({ plans: PLANS });
}
exports.getPlans = getPlans;
// GET /subscriptions/me
async function getMySubscription(req, res) {
    const userId = req.userId;
    // Lazy-expire any lapsed subscription for this user before we return state.
    await checkExpiredSubscriptions(userId);
    const { data } = await supabase_1.supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    const { data: user } = await supabase_1.supabase
        .from('users')
        .select('coin_balance, is_premium, premium_expires_at')
        .eq('id', userId)
        .single();
    return res.json({ subscription: data, coinBalance: user?.coin_balance ?? 0, isPremium: user?.is_premium ?? false, premiumExpiresAt: user?.premium_expires_at });
}
exports.getMySubscription = getMySubscription;
// POST /subscriptions/initiate  { planId }
async function initiate(req, res) {
    const userId = req.userId;
    const { planId } = req.body || {};
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan)
        return res.status(400).json({ error: 'Invalid plan' });
    // Create a pending subscription record
    const expiresAt = plan.months > 0
        ? new Date(Date.now() + plan.months * 30 * 24 * 60 * 60 * 1000).toISOString()
        : null;
    const { data: sub, error } = await supabase_1.supabase
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
    if (error)
        return res.status(500).json({ error: error.message });
    // In production, create Razorpay order here. For now return mock order.
    return res.json({
        subscriptionId: sub.id,
        razorpayOrderId: `order_mock_${sub.id.slice(0, 8)}`,
        amount: plan.price * 100, // paise
        currency: 'INR',
        planName: plan.name,
    });
}
exports.initiate = initiate;
// POST /subscriptions/verify  { subscriptionId, razorpayPaymentId, razorpayOrderId, razorpaySignature }
async function verify(req, res) {
    const userId = req.userId;
    const { subscriptionId, razorpayPaymentId, razorpayOrderId } = req.body || {};
    if (!subscriptionId)
        return res.status(400).json({ error: 'subscriptionId required' });
    // In production, verify Razorpay signature here.
    // For now, activate the subscription directly.
    const { data: sub } = await supabase_1.supabase
        .from('subscriptions')
        .select('*')
        .eq('id', subscriptionId)
        .eq('user_id', userId)
        .single();
    if (!sub)
        return res.status(404).json({ error: 'Subscription not found' });
    const plan = PLANS.find((p) => p.id === sub.plan_id);
    // Activate subscription
    await supabase_1.supabase
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
        const { data: usr } = await supabase_1.supabase.from('users').select('coin_balance').eq('id', userId).single();
        await supabase_1.supabase.from('users').update({ coin_balance: (usr?.coin_balance ?? 0) + 50 }).eq('id', userId);
    }
    else {
        await supabase_1.supabase.from('users').update({
            is_premium: true,
            premium_expires_at: sub.expires_at,
        }).eq('id', userId);
    }
    // Record transaction
    await supabase_1.supabase.from('transactions').insert({
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
exports.verify = verify;
// POST /subscriptions/apple/verify  { receipt, planId }
async function appleVerify(req, res) {
    const userId = req.userId;
    const { planId } = req.body || {};
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan)
        return res.status(400).json({ error: 'Invalid plan' });
    // In production, verify Apple receipt with App Store. For now, auto-activate.
    const expiresAt = plan.months > 0
        ? new Date(Date.now() + plan.months * 30 * 24 * 60 * 60 * 1000).toISOString()
        : null;
    const { data: sub } = await supabase_1.supabase
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
        const { data: usr } = await supabase_1.supabase.from('users').select('coin_balance').eq('id', userId).single();
        await supabase_1.supabase.from('users').update({ coin_balance: (usr?.coin_balance ?? 0) + 50 }).eq('id', userId);
    }
    else {
        await supabase_1.supabase.from('users').update({
            is_premium: true,
            premium_expires_at: expiresAt,
        }).eq('id', userId);
    }
    await supabase_1.supabase.from('transactions').insert({
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
exports.appleVerify = appleVerify;
// POST /subscriptions/coupon  { code }
async function redeemCoupon(req, res) {
    const userId = req.userId;
    const { code } = req.body || {};
    if (!code)
        return res.status(400).json({ error: 'code required' });
    // Prefer the coupon_codes table (single source of truth). Fall back to the
    // hard-coded map so existing deployments keep working if the table lookup
    // fails for any reason. Production schema (verified 2026-04-11):
    //   id, code, description, premium_months, coins, max_uses (nullable),
    //   uses_count, expires_at, active, created_at.
    const upperCode = code.toUpperCase();
    let months = 0;
    let coins = 0;
    let couponExpiry = null;
    let couponDbId = null;
    const { data: couponRow } = await supabase_1.supabase
        .from('coupon_codes')
        .select('id, code, premium_months, coins, expires_at, max_uses, uses_count, active')
        .eq('code', upperCode)
        .maybeSingle();
    if (couponRow) {
        if (couponRow.active === false) {
            return res.status(400).json({ error: 'Coupon is disabled' });
        }
        // max_uses is nullable — null means unlimited.
        if (couponRow.max_uses != null &&
            couponRow.max_uses > 0 &&
            (couponRow.uses_count ?? 0) >= couponRow.max_uses) {
            return res.status(400).json({ error: 'Coupon fully redeemed' });
        }
        months = couponRow.premium_months ?? 0;
        coins = couponRow.coins ?? 0;
        couponExpiry = couponRow.expires_at ? new Date(couponRow.expires_at) : null;
        couponDbId = couponRow.id;
    }
    else {
        const legacy = COUPONS[upperCode];
        if (!legacy)
            return res.status(400).json({ error: 'Invalid coupon code' });
        months = legacy.months;
        coins = legacy.coins;
        couponExpiry = new Date(legacy.expiresAt);
    }
    if (couponExpiry && couponExpiry < new Date()) {
        return res.status(400).json({ error: 'Coupon expired' });
    }
    const coupon = { months, coins };
    // Check if already used
    const { data: existing } = await supabase_1.supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', userId)
        .eq('coupon_code', code.toUpperCase())
        .limit(1)
        .maybeSingle();
    if (existing)
        return res.status(400).json({ error: 'Coupon already used' });
    const expiresAt = new Date(Date.now() + coupon.months * 30 * 24 * 60 * 60 * 1000).toISOString();
    // Create subscription
    await supabase_1.supabase.from('subscriptions').insert({
        user_id: userId,
        plan_id: `coupon_${code.toUpperCase()}`,
        status: 'active',
        amount_inr: 0,
        payment_provider: 'coupon',
        coupon_code: code.toUpperCase(),
        expires_at: expiresAt,
    });
    // Activate premium + add coins
    const { data: usr } = await supabase_1.supabase.from('users').select('coin_balance').eq('id', userId).single();
    await supabase_1.supabase.from('users').update({
        is_premium: true,
        premium_expires_at: expiresAt,
        coin_balance: (usr?.coin_balance ?? 0) + coupon.coins,
    }).eq('id', userId);
    // Record transaction
    await supabase_1.supabase.from('transactions').insert({
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
        const { data: fresh } = await supabase_1.supabase
            .from('coupon_codes')
            .select('uses_count')
            .eq('id', couponDbId)
            .maybeSingle();
        if (fresh) {
            await supabase_1.supabase
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
exports.redeemCoupon = redeemCoupon;
// POST /subscriptions/cancel
async function cancel(req, res) {
    const userId = req.userId;
    const { data: sub } = await supabase_1.supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!sub)
        return res.status(404).json({ error: 'No active subscription' });
    await supabase_1.supabase.from('subscriptions').update({
        auto_renew: false,
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    return res.json({ success: true, message: 'Auto-renew disabled. Subscription active until expiry.' });
}
exports.cancel = cancel;
//# sourceMappingURL=subscriptions.controller.js.map