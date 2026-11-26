import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { awardCoins } from '../utils/coins';
import { COIN_RULES } from '../utils/coinRules';
import crypto from 'crypto';
import { selectAll } from '../utils/selectAll';
import { canonicalisePhone, isValidIndianPhone } from '../utils/phone';

/**
 * Q18 (Dipak, 21 Nov 2026, chose B): a phone number claims invite coins once, ever — even after
 * the account is deleted and the number is freed (30 days later) for a brand-new account. Kept by
 * a hash of the number only (migration 165, referral_phone_claims); the number itself is erased
 * with the account. Same hash as the migration's backfill.
 */
export function referralPhoneHash(canonicalPhone: string): string {
  return crypto.createHash('sha256').update(`sportclan-referral:${canonicalPhone}`, 'utf8').digest('hex');
}
export const REFERRAL_PHONE_USED = {
  error: 'This phone number has already used an invite code, so it can’t get the invite coins again.',
  code: 'REFERRAL_PHONE_USED',
};
/** 'claimed' when this number had never claimed (and now has); 'used' when it had; 'skip' with no real number or no table yet. */
async function claimReferralPhone(phone: string | null | undefined, userId: string): Promise<'claimed' | 'used' | 'skip'> {
  const p = phone ? canonicalisePhone(phone) : null;
  if (!p || !isValidIndianPhone(p)) return 'skip'; // an email sign-up's placeholder number
  const { error } = await supabase.from('referral_phone_claims').insert({ phone_hash: referralPhoneHash(p), user_id: userId });
  if (!error) return 'claimed';
  if ((error as { code?: string }).code === '23505') return 'used';
  // Before migration 165 runs (no table): the old rule (once per account) still holds.
  // eslint-disable-next-line no-console
  console.error('[referrals] phone claim not recorded:', (error as { message?: string }).message);
  return 'skip';
}

// F067 (launch test plan): the shared coin rules the Wallet says.
const REFERRAL_COINS = COIN_RULES.referral;

/**
 * Decision 9 (B10-D1): a friend's code is for new accounts — it can be applied
 * only within 30 days of sign-up. Before this, two long-standing friends could
 * apply each other's codes and both bank the coins.
 */
export const REFERRAL_WINDOW_DAYS = COIN_RULES.referralWindowDays;
export function referralApplyUntil(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) ? new Date(t + REFERRAL_WINDOW_DAYS * 86400000).toISOString() : null;
}

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
    .select('id, name, referred_by')
    .eq('referral_code', normalised)
    .is('deleted_at', null) // N-R7-S42: a deleted account's code isn't a code any more
    .maybeSingle();
  if (!referrer) {
    return res.status(404).json({ error: 'Invalid referral code' });
  }
  if (referrer.id === userId) {
    return res.status(400).json({ error: 'Cannot use your own code' });
  }
  // E-016 (Round 6): this friend joined with YOUR code, so you invited them —
  // using theirs back paid both sides a second time (4 rewards for one pair).
  if ((referrer as { referred_by?: string | null }).referred_by === userId) {
    return res.status(400).json({
      error: 'This friend joined with your code, so you can’t use theirs.',
      code: 'REFERRAL_CIRCULAR',
    });
  }

  const { data: me } = await supabase
    .from('users')
    .select('id, referred_by, created_at, phone')
    .eq('id', userId)
    .maybeSingle();
  if (!me) return res.status(404).json({ error: 'User not found' });
  if (me.referred_by) {
    return res.status(400).json({ error: 'Referral already applied' });
  }
  const until = referralApplyUntil(me.created_at);
  if (!until || Date.parse(until) <= Date.now()) {
    return res.status(403).json({
      error: `A friend’s code can only be used within ${REFERRAL_WINDOW_DAYS} days of joining.`,
      code: 'REFERRAL_WINDOW_CLOSED',
    });
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
  // Q18: the number's once-ever claim first (atomic on its key), before the account's claim and any coins.
  const phoneClaim = await claimReferralPhone((me as { phone?: string | null }).phone, userId);
  if (phoneClaim === 'used') return res.status(403).json(REFERRAL_PHONE_USED);

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
  const mine = await awardCoins(userId, `referral_applied_${referrer.id}`, REFERRAL_COINS, 'Used an invite code');
  const theirs = await awardCoins(referrer.id, `referral_reward_${userId}`, REFERRAL_COINS, 'A friend joined with your code');

  return res.json({
    success: true,
    referrerName: referrer.name,
    coinsAwarded: REFERRAL_COINS,
    newBalance: mine.newBalance,
    referrerNewBalance: theirs.newBalance,
  });
}

/** The like-pattern prefixes of the referral coin events (underscores escaped: `_` is a LIKE wildcard). */
const REWARD = 'referral_reward_';
const APPLIED = 'referral_applied_';
const likePrefix = (p: string) => `${p.replace(/_/g, '\\_')}%`;

// GET /referrals/stats
// Returns the caller's referral code, the count of people they've referred, and
// the coins referrals earned them: 'referral_reward_<friend>' (a friend used
// their code) and 'referral_applied_<friend>' (they used a friend's).
export async function getStats(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // Item 4 (25 Nov 2026): a failed read used to answer 200 with no code; the app shows its Retry on an error.
  const { data: me, error: meErr } = await supabase
    .from('users')
    .select('referral_code, referred_by, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (meErr) return res.status(500).json({ error: 'Could not load referral stats' });
  if (!me) return res.status(404).json({ error: 'User not found' });

  // Item 5 (25 Nov 2026): a friend's purged account loses its referred_by link, so the
  // links alone dropped the count while the coins stayed. Friends = the links plus the
  // friends in the reward events, each once. Only the number leaves the server.
  // SC-383: read in pages, and an error is an error (never a plausible 0).
  const friends = new Set<string>();
  let totalCoinsEarned = 0;
  try {
    const links = await selectAll<{ id: string }>((from, to) => supabase.from('users')
      .select('id').eq('referred_by', userId).order('id', { ascending: true }).range(from, to));
    for (const l of links) friends.add(l.id);
    for (const prefix of [REWARD, APPLIED]) {
      const events = await selectAll<{ event_type: string; coins: number | null }>((from, to) => supabase.from('coin_events')
        .select('event_type, coins').eq('user_id', userId).like('event_type', likePrefix(prefix))
        .order('event_type', { ascending: true }).range(from, to));
      for (const e of events) {
        totalCoinsEarned += e.coins ?? 0; // Item 6: and the coins for using a friend's code
        if (prefix === REWARD) friends.add(e.event_type.slice(REWARD.length));
      }
    }
  } catch {
    return res.status(500).json({ error: 'Could not load referral stats' });
  }

  return res.json({
    referralCode: me.referral_code ?? null,
    referralCount: friends.size,
    totalCoinsEarned,
    // Phase 3 B10-F18: the app hides "Have a friend's code?" once one is used —
    // it only learned that on submit ("Referral already applied").
    alreadyApplied: !!me.referred_by,
    // Decision 9: when this account's window to use a friend's code closes.
    applyUntil: referralApplyUntil(me.created_at),
  });
}
