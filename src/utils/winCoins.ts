/**
 * V-6 · a voided win pays nothing; a restored one pays again.
 *
 * Voiding a ranked match reversed rating, matches and W/L, but the +5 "Won a
 * match" coins stayed. Keys like `win_match_<id>` can't simply be deleted or
 * re-inserted, because a match can be voided and restored any number of times.
 *
 * So this RECONCILES instead of toggling: for each participant it works out
 * what their net win coins for this match SHOULD be — 5 when the match counts
 * (completed, ranked, not voided) and they were on the winning side, else 0 —
 * reads what the coin ledger already holds for this match, and writes only the
 * difference, under a numbered key (`win_match_<id>_adj_<n>`). Running it twice
 * is a no-op; two racing runs collide on the (user, event_type) unique key.
 *
 * A clawback never takes a balance below zero: someone who has spent the coins
 * loses what they still have, the ledger records exactly that, and a later
 * restore puts back the true difference.
 */
import { supabase } from './supabase';
import { awardCoins } from './coins';

export const WIN_COINS = 5;

export interface WinCoinPlan {
  userId: string;
  delta: number;
}

/** Pure: the adjustment each participant needs. */
export function planWinCoins(args: {
  counts: boolean;
  winnerSide: 'A' | 'B' | null;
  participants: Array<{ user_id: string; team_side: string | null }>;
  ledger: Map<string, number>;     // user → net win coins already paid for this match
  balances: Map<string, number>;   // user → current coin balance
}): WinCoinPlan[] {
  const out: WinCoinPlan[] = [];
  for (const p of args.participants) {
    const desired = args.counts && args.winnerSide && p.team_side === args.winnerSide ? WIN_COINS : 0;
    const net = args.ledger.get(p.user_id) ?? 0;
    let delta = desired - net;
    if (delta < 0) delta = -Math.min(-delta, Math.max(0, args.balances.get(p.user_id) ?? 0));
    if (delta !== 0) out.push({ userId: p.user_id, delta });
  }
  return out;
}

export async function reconcileWinCoins(matchId: string): Promise<void> {
  const { data: match } = await supabase
    .from('matches')
    .select('id, status, is_ranked, voided_at, winner_team_id, team_a_id, team_b_id, team_a_name, team_b_name, score_summary')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return;
  const { data: parts } = await supabase.from('match_participants').select('user_id, team_side').eq('match_id', matchId);
  const participants = (parts ?? []) as Array<{ user_id: string; team_side: string | null }>;
  if (participants.length === 0) return;

  const ss = (match.score_summary ?? {}) as { winner_side?: 'A' | 'B' | null };
  const winnerSide: 'A' | 'B' | null =
    match.winner_team_id && match.winner_team_id === match.team_a_id ? 'A'
    : match.winner_team_id && match.winner_team_id === match.team_b_id ? 'B'
    : ss.winner_side === 'A' || ss.winner_side === 'B' ? ss.winner_side : null;
  const counts = match.status === 'completed' && !!match.is_ranked && !match.voided_at;

  const ids = participants.map((p) => p.user_id);
  const prefix = `win_match_${matchId}`;
  const [{ data: events }, { data: users }] = await Promise.all([
    supabase.from('coin_events').select('user_id, event_type, coins').in('user_id', ids).like('event_type', `${prefix}%`),
    supabase.from('users').select('id, coin_balance').in('id', ids),
  ]);
  const ledger = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const e of events ?? []) {
    ledger.set(e.user_id as string, (ledger.get(e.user_id as string) ?? 0) + Number(e.coins ?? 0));
    seen.set(e.user_id as string, (seen.get(e.user_id as string) ?? 0) + 1);
  }
  const balances = new Map((users ?? []).map((u) => [u.id as string, Number(u.coin_balance ?? 0)]));

  const label = `${match.team_a_name || 'Team A'} vs ${match.team_b_name || 'Team B'}`;
  for (const { userId, delta } of planWinCoins({ counts, winnerSide, participants, ledger, balances })) {
    const key = `${prefix}_adj_${seen.get(userId) ?? 0}`;
    await awardCoins(
      userId,
      key,
      delta,
      // D22 (visual review V074): "returned" read as coins coming TO you, and no
      // row said which match. Say what happened, and to which match.
      delta > 0 ? `Win coins back · ${label} (match restored)` : `Win coins taken back · ${label}`,
      delta > 0 ? 'coins_earned' : 'coins_reversed',
    );
  }
}
