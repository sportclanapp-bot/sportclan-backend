import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { awardCoins } from '../utils/coins';

const REFERRAL_COINS = 20;

// Generates an 8-char referral code like "SCK3P9QA". Caller must check
// uniqueness against users.referral_code.
export function generateReferralCode(): string {
  return 'SC' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// POST /referrals/apply  { code }
// Validates the code against users.referral_code, sets the caller's
// referred_by, awards coins to both sides via awardCoins (which dedupes
// through coin_events).
export async function applyReferral(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { code } = req.body ?? {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code is required' });
  }

  const normalised = code.trim().toUpperCase();

  // Look up the referrer.
  const { data: referrer } = await supabase
    .from('users')
    .select('id, name')
    .eq('referral_code', normalised)
    .maybeSingle();
  if (!referrer) {
    return res.status(404).json({ error: 'Invalid referral code' });
  }
  if (referrer.id === userId) {
    return res.status(400).json({ error: 'Cannot use your own code' });
  }

  // Load caller's current referred_by — only let them apply a code once.
  const { data: me } = await supabase
    .from('users')
    .select('id, referred_by, name')
    .eq('id', userId)
    .maybeSingle();
  if (!me) return res.status(404).json({ error: 'User not found' });
  if (me.referred_by) {
    return res.status(400).json({ error: 'Referral already applied' });
  }

  // Set referred_by and award both parties.
  await supabase
    .from('users')
    .update({ referred_by: referrer.id })
    .eq('id', userId);

  // Coin awards — awardCoins is idempotent via coin_events unique key.
  const mine = await awardCoins(userId, `referral_applied_${referrer.id}`, REFERRAL_COINS);
  const theirs = await awardCoins(referrer.id, `referral_reward_${userId}`, REFERRAL_COINS);

  return res.json({
    success: true,
    referrerName: referrer.name,
    coinsAwarded: REFERRAL_COINS,
    newBalance: mine.newBalance,
    referrerNewBalance: theirs.newBalance,
  });
}

// GET /referrals/stats
// Returns the caller's referral code, count of people they've referred,
// and total coins earned from referrals (sum of their coin_events rows
// whose event_type starts with 'referral_reward_').
export async function getStats(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { data: me } = await supabase
    .from('users')
    .select('referral_code')
    .eq('id', userId)
    .maybeSingle();

  const { count: referralCount } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by', userId);

  const { data: events } = await supabase
    .from('coin_events')
    .select('coins, event_type')
    .eq('user_id', userId)
    .like('event_type', 'referral_reward_%');
  const totalCoinsEarned = (events ?? []).reduce((sum, e: any) => sum + (e.coins ?? 0), 0);

  return res.json({
    referralCode: me?.referral_code ?? null,
    referralCount: referralCount ?? 0,
    totalCoinsEarned,
  });
}
