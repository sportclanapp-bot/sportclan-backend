import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';

// ─── Change #7 CRITICAL: ALL 10 PRD gifts ──────────────────────────────────────
const GIFT_CATALOGUE = [
  { id: 'gold_trophy',   emoji: '\u{1F3C6}', name: 'Gold Trophy',   cost: 15 },
  { id: 'silver_trophy', emoji: '\u{1F948}', name: 'Silver Trophy', cost: 10 },
  { id: 'gold_medal',    emoji: '\u{1F947}', name: 'Gold Medal',    cost: 12 },
  { id: 'silver_medal',  emoji: '\u{1F396}\uFE0F', name: 'Silver Medal',  cost: 8 },
  { id: 'best_player',   emoji: '\u2B50',    name: 'Best Player',   cost: 10 },
  { id: 'flowers',       emoji: '\u{1F490}', name: 'Flowers',       cost: 5 },
  { id: 'star_player',   emoji: '\u{1F31F}', name: 'Star Player',   cost: 12 },
  { id: 'appreciation',  emoji: '\u{1F44F}', name: 'Appreciation',  cost: 5 },
  { id: 'fire',          emoji: '\u{1F525}', name: 'Fire',          cost: 5 },
  { id: 'crown',         emoji: '\u{1F451}', name: 'Crown',         cost: 8 },
];

// GET /gifts/catalogue
export async function getCatalogue(_req: Request, res: Response) {
  return res.json({ gifts: GIFT_CATALOGUE });
}

// POST /gifts/send  { receiverId, giftId, message? }
export async function sendGift(req: Request, res: Response) {
  const senderId = req.userId!;
  const { receiverId, giftId, message, idempotency_key } = req.body || {};

  if (!receiverId || !giftId) return res.status(400).json({ error: 'receiverId and giftId required' });
  if (senderId === receiverId) return res.status(400).json({ error: 'Cannot send gift to yourself' });

  const gift = GIFT_CATALOGUE.find((g) => g.id === giftId);
  if (!gift) return res.status(400).json({ error: 'Invalid gift' });

  // Check sender's premium status
  const { data: sender } = await supabase
    .from('users')
    .select('coin_balance, is_premium')
    .eq('id', senderId)
    .single();

  if (!sender) return res.status(404).json({ error: 'Sender not found' });
  if (!sender.is_premium) return res.status(403).json({ error: 'Premium required to send gifts' });
  if (sender.coin_balance < gift.cost) {
    return res.status(400).json({
      error: 'Insufficient coins',
      required: gift.cost,
      current: sender.coin_balance,
    });
  }

  // Check receiver exists
  const { data: receiver } = await supabase.from('users').select('id').eq('id', receiverId).single();
  if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

  // SC-114: atomic, retry-idempotent send via the send_gift RPC (migration 052).
  // idempotency_key (a client UUID per tap) dedups retries → the original result,
  // no 2nd deduct; a no-key send uses a short ~1.5s backstop window. Dedup + deduct
  // + gift + ledger all run in ONE transaction. Falls back to the pre-052 sequential
  // path if the RPC isn't deployed yet (safe pre-migration deploy).
  const rpc = await supabase.rpc('send_gift', {
    p_sender: senderId,
    p_receiver: receiverId,
    p_gift_id: giftId,
    p_emoji: gift.emoji,
    p_name: gift.name,
    p_cost: gift.cost,
    p_message: message || null,
    p_client_key: idempotency_key || null,
  });
  if (rpc.error && rpc.error.code === 'PGRST202') {
    // ── Pre-migration fallback (current behaviour): deduct → insert (+refund) → ledger.
    const { data: newBalance, error: deductErr } = await supabase
      .rpc('deduct_coins_if_sufficient', { target_user_id: senderId, amount: gift.cost });
    if (deductErr) return res.status(500).json({ error: 'Could not deduct coins' });
    if (newBalance === null || newBalance === undefined) {
      return res.status(400).json({ error: 'Insufficient coins', required: gift.cost });
    }
    const { data: giftTx, error } = await supabase
      .from('gift_transactions')
      .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        gift_id: giftId,
        gift_emoji: gift.emoji,
        gift_name: gift.name,
        coin_cost: gift.cost,
        message: message || null,
      })
      .select()
      .single();
    if (error) {
      await supabase.rpc('increment_coins', { target_user_id: senderId, amount: gift.cost });
      return res.status(500).json({ error: sanitizeError(error) });
    }
    await supabase.from('transactions').insert([
      { user_id: senderId, type: 'gift_sent', coins: -gift.cost, description: `Sent ${gift.name} ${gift.emoji}`, reference_id: giftTx.id, status: 'completed' },
      { user_id: receiverId, type: 'gift_received', coins: 0, description: `Received ${gift.name} ${gift.emoji}`, reference_id: giftTx.id, status: 'completed' },
    ]);
    return res.json({ success: true, giftTransaction: giftTx, remainingBalance: newBalance });
  }
  if (rpc.error) return res.status(500).json({ error: sanitizeError(rpc.error) });
  const out = (rpc.data ?? {}) as { status?: string; gift?: any; new_balance?: number };
  if (out.status === 'insufficient') {
    return res.status(400).json({ error: 'Insufficient coins', required: gift.cost });
  }
  // 'sent' or 'duplicate' — duplicate = an idempotent retry (no double charge).
  return res.json({
    success: true,
    giftTransaction: out.gift,
    remainingBalance: out.new_balance,
    alreadySent: out.status === 'duplicate',
  });
}

// GET /gifts/received?userId=
export async function getReceivedGifts(req: Request, res: Response) {
  const userId = (req.query.userId as string) || req.userId!;

  const { data, error } = await supabase
    .from('gift_transactions')
    .select('*, sender:sender_id(id, name, username, profile_picture_url)')
    .eq('receiver_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.json({ gifts: data ?? [] });
}

// GET /gifts/sent
export async function getSentGifts(req: Request, res: Response) {
  const userId = req.userId!;

  const { data, error } = await supabase
    .from('gift_transactions')
    .select('*, receiver:receiver_id(id, name, username, profile_picture_url)')
    .eq('sender_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.json({ gifts: data ?? [] });
}
