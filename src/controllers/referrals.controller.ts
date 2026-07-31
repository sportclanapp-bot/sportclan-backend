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

  const { data: me } = await supabase
    .from('users')
    .select('id, referred_by')
    .eq('id', userId)
    .maybeSingle();
  if (!me) return res.status(404).json({ error: 'User not found' });
  if (me.referred_by) {
    return res.status(400).json({ error: 'Referral already applied' });
  }

  // SC-383: claim the referral ATOMICALLY (the SC-48 pattern). The check above
  // is a read, and a read-then-write cannot enforce "once per account" — two
  // concurrent applies can both see referred_by NULL and both proceed. That
  // matters here because the coin dedupe key is `referral_applied_<referrerId>`:
  // different referrers are different keys, so awardCoins would NOT collapse
  // them, and a burst of N codes would bank 20 x N coins on a single account
  // while paying N referrers. Postgres serialises concurrent UPDATEs on the same
  // row, so exactly one request flips NULL -> referrer and gets a row back; the
  // losers get zero rows and are rejected before any coins move.
  const { data: claim, error: claimErr } = await supabase
    .from('users')
    .update({ referred_by: referrer.id })
    .eq('id', userId)
    .is('referred_by', null)
    .select('id');
  if (claimErr) return res.status(500).json({ error: 'Could not apply referral' });
  if (!claim || claim.length === 0) {
    return res.status(400).json({ error: 'Referral already applied' });
  }

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

  // count:'exact' is the true total (not a loaded page length) — but the error
  // still has to be surfaced, or a failed count reads as "0 people referred".
  const { count: referralCount, error: countErr } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by', userId);
  if (countErr) return res.status(500).json({ error: 'Could not load referral stats' });

  // SC-383: sum every reward row, in pages, and do NOT swallow the error.
  // Two bugs this app has shipped repeatedly are both live in this one query:
  // a discarded error reads as a plausible 0 ("you've earned nothing" instead
  // of "we couldn't tell"), and an unpaged select is capped by PostgREST's row
  // limit, so a prolific referrer's total would silently stop growing at the
  // page size. Page until exhausted and surface a failure as a failure.
  const PAGE = 1000;
  let totalCoinsEarned = 0;
  for (let from = 0; ; from += PAGE) {
    const { data: events, error: evErr } = await supabase
      .from('coin_events')
      .select('coins')
      .eq('user_id', userId)
      .like('event_type', 'referral_reward_%')
      .range(from, from + PAGE - 1);
    if (evErr) return res.status(500).json({ error: 'Could not load referral stats' });
    totalCoinsEarned += (events ?? []).reduce((sum, e: any) => sum + (e.coins ?? 0), 0);
    if (!events || events.length < PAGE) break;
  }

  return res.json({
    referralCode: me?.referral_code ?? null,
    referralCount: referralCount ?? 0,
    totalCoinsEarned,
  });
}
