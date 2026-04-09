import { Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../utils/supabase';

// POST /webhooks/razorpay
export async function razorpayWebhook(req: Request, res: Response) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhooks] RAZORPAY_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Verify signature
  const signature = req.headers['x-razorpay-signature'] as string;
  if (!signature) return res.status(400).json({ error: 'Missing signature' });

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = req.body?.event;
  const payload = req.body?.payload;

  if (event === 'payment.captured') {
    const payment = payload?.payment?.entity;
    if (!payment) return res.status(400).json({ error: 'No payment entity' });

    const orderId = payment.order_id;
    const paymentId = payment.id;

    // Find pending subscription by order_id
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('provider_order_id', orderId)
      .eq('status', 'pending')
      .maybeSingle();

    if (sub) {
      // Activate subscription
      await supabase.from('subscriptions').update({
        status: 'active',
        provider_payment_id: paymentId,
        updated_at: new Date().toISOString(),
      }).eq('id', sub.id);

      // Activate premium on user
      if (sub.plan_id === 'coins_50') {
        const { data: usr } = await supabase.from('users').select('coin_balance').eq('id', sub.user_id).single();
        await supabase.from('users').update({
          coin_balance: (usr?.coin_balance ?? 0) + 50,
        }).eq('id', sub.user_id);
      } else {
        await supabase.from('users').update({
          is_premium: true,
          premium_expires_at: sub.expires_at,
        }).eq('id', sub.user_id);
      }

      // Record transaction
      await supabase.from('transactions').insert({
        user_id: sub.user_id,
        type: sub.plan_id === 'coins_50' ? 'coins' : 'subscription',
        amount_inr: sub.amount_inr,
        coins: sub.plan_id === 'coins_50' ? 50 : 0,
        description: `${sub.plan_id} — Razorpay webhook`,
        reference_id: paymentId,
        status: 'completed',
      });
    }
  }

  // Always return 200 to Razorpay
  return res.json({ ok: true });
}
