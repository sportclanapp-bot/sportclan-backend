/**
 * Player-vs-player singles (Phase 3, decision 1 + 2).
 *
 * Until now every match was team vs team. Two players who did not share a team
 * could not play a linked match at all, and a one-a-side sport could never be
 * ranked from the app. So for the one-a-side sports a match can now be created
 * between two PEOPLE:
 *
 *   - no team ids; the two players are the match's participants, A and B,
 *     seeded at creation (so it always has a line-up and always counts);
 *   - the sides carry the players' names in team_a_name / team_b_name, so every
 *     existing surface that prints "A vs B" prints the right thing;
 *   - it may be ranked with one player a side (the backend allowed that since
 *     SC-74 — the app was the part that refused);
 *   - a RANKED singles match cannot start until the opponent has accepted,
 *     which is their availability row set to 'available'. No schema change:
 *     "singles" is exactly "no teams, one participant each side", and a ranked
 *     match with no teams can only have been created as singles.
 */
import { supabase } from './supabase';

/** Sports that are played one-a-side, as normalised slugs. */
export const SINGLES_SPORTS = new Set(['badminton', 'tennis', 'tabletennis', 'pickleball', 'chess', 'carrom']);

export const normSlug = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[-_\s]/g, '');

export function isSinglesSport(slug: string | null | undefined): boolean {
  return SINGLES_SPORTS.has(normSlug(slug));
}

export interface ParticipantLite {
  user_id: string;
  team_side: string | null;
}

/** No teams, exactly one participant on each side. */
export function isSinglesShape(
  match: { team_a_id?: string | null; team_b_id?: string | null },
  participants: ParticipantLite[] | null | undefined,
): boolean {
  if (match.team_a_id || match.team_b_id) return false;
  const ps = participants ?? [];
  return ps.filter((p) => p.team_side === 'A').length === 1 && ps.filter((p) => p.team_side === 'B').length === 1;
}

/**
 * The side that won, however the caller said it.
 *
 * A team match names its winner by team id. A match with no teams — singles, or
 * a casual free-text match — cannot, so completion also accepts `winner_side`.
 * Without it a decisive free-text match could never be completed at all (the
 * "no side has won" guard fired on a null team id), and a ranked singles win
 * would have been scored as a draw (outcome was derived from team ids only).
 */
export function winnerSideOf(args: {
  winner_team_id?: string | null;
  winner_side?: unknown;
  team_a_id?: string | null;
  team_b_id?: string | null;
}): 'A' | 'B' | null {
  const { winner_team_id, winner_side, team_a_id, team_b_id } = args;
  if (winner_team_id) {
    if (team_a_id && winner_team_id === team_a_id) return 'A';
    if (team_b_id && winner_team_id === team_b_id) return 'B';
    return null;
  }
  return winner_side === 'A' || winner_side === 'B' ? winner_side : null;
}

/** The copy the opponent sees when challenged. */
export function challengeText(args: {
  challengerName: string;
  sportName: string;
  ranked: boolean;
  when: string | null;
}): { title: string; body: string } {
  // V-2: a sentence, so it starts with a capital — it reads on its own under the title.
  const kind = args.ranked ? 'A ranked' : 'A';
  const when = args.when ? ` · ${args.when}` : '';
  return {
    title: `${args.challengerName} challenged you`,
    body: `${kind} ${args.sportName.toLowerCase()} singles match${when}. Open it to accept or decline.`,
  };
}

/**
 * For the ranked-start gate: is this a ranked singles match whose opponent has
 * not accepted yet? Returns the opponent's name so the refusal can say who.
 */
export async function pendingRankedOpponent(match: {
  id: string;
  is_ranked?: boolean | null;
  team_a_id?: string | null;
  team_b_id?: string | null;
  team_b_name?: string | null;
}): Promise<{ pending: boolean; opponentName: string | null }> {
  if (!match.is_ranked || match.team_a_id || match.team_b_id) return { pending: false, opponentName: null };
  const { data: parts } = await supabase
    .from('match_participants')
    .select('user_id, team_side')
    .eq('match_id', match.id);
  if (!isSinglesShape(match, parts ?? [])) return { pending: false, opponentName: null };
  const opponentId = (parts ?? []).find((p) => p.team_side === 'B')?.user_id as string;
  const { data: av } = await supabase
    .from('match_availability')
    .select('status')
    .eq('match_id', match.id)
    .eq('user_id', opponentId)
    .maybeSingle();
  return { pending: (av as { status?: string } | null)?.status !== 'available', opponentName: match.team_b_name ?? null };
}
