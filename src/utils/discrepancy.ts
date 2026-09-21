/**
 * SC-433 · raising and clearing "the result and the play disagree".
 *
 * Kept out of the controllers because it has to run from three places — a result
 * op arriving, events arriving, and an ordinary completion — and a rule that
 * important should have exactly one implementation.
 */
import { supabase } from './supabase';
import { isTerminalMatchStatus } from './validation';
import { checkResultAgainstPlay, sideFromSummary, sideOfTeam, type Side } from './resultCheck';

export type DetectedBy = 'result_op' | 'events' | 'complete';

/**
 * Compare what the match records against what its events add up to, and record
 * the argument if they differ.
 *
 * Never changes the match. That is the whole point: a tournament result that
 * quietly flipped is far worse than one that stopped and asked, and the server
 * genuinely cannot tell which side is right — the events may be incomplete, or
 * the result may have been recorded on the wrong court.
 *
 * Returns the verdict so the caller can tell the person in front of it, rather
 * than leaving the news for whenever someone next opens the organiser screen.
 */
export async function checkAndRecordDiscrepancy(
  matchId: string,
  detectedBy: DetectedBy,
): Promise<{ disagrees: boolean; recordedSide: Side | null; derivedSide: Side | null }> {
  const { data: match } = await supabase
    .from('matches')
    .select('id, tournament_id, team_a_id, team_b_id, status, winner_team_id, score_summary')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return { disagrees: false, recordedSide: null, derivedSide: null };

  const m = match as {
    tournament_id: string | null; team_a_id: string | null; team_b_id: string | null;
    status: string | null; winner_team_id: string | null; score_summary: unknown;
  };

  const { count } = await supabase
    .from('match_events')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId);

  const verdict = checkResultAgainstPlay({
    matchStatus: m.status,
    isTerminal: isTerminalMatchStatus,
    teamAId: m.team_a_id,
    teamBId: m.team_b_id,
    recordedWinnerTeamId: m.winner_team_id,
    // A completed match HAS a result, and a completed match with no winner is a
    // draw rather than an undecided one.
    hasRecordedResult: isTerminalMatchStatus(m.status),
    derivedSummary: m.score_summary,
    eventCount: count ?? 0,
  });

  if (!verdict.disagrees) {
    // They agree now. If an earlier disagreement was recorded and nobody has
    // resolved it, it is no longer true — more events arrived, or the result was
    // corrected — so it must not sit there accusing people forever.
    await supabase
      .from('result_discrepancies')
      .update({
        resolved_at: new Date().toISOString(),
        resolution: 'agreed_on_its_own',
      })
      .eq('match_id', matchId)
      .is('resolved_at', null);
    return { disagrees: false, recordedSide: verdict.recordedSide, derivedSide: verdict.derivedSide };
  }

  // Upsert-by-hand against the partial unique index: one OPEN row per match, so a
  // second detection of the same unresolved argument updates rather than piles up.
  const { data: open } = await supabase
    .from('result_discrepancies')
    .select('id')
    .eq('match_id', matchId)
    .is('resolved_at', null)
    .maybeSingle();

  const row = {
    match_id: matchId,
    tournament_id: m.tournament_id,
    recorded_winner_team_id: m.winner_team_id,
    recorded_side: verdict.recordedSide,
    derived_winner_side: verdict.derivedSide,
    recorded_summary: null,
    derived_summary: m.score_summary ?? null,
    detected_by: detectedBy,
  };
  if (open) {
    await supabase.from('result_discrepancies')
      .update({ ...row, detected_at: new Date().toISOString() })
      .eq('id', (open as { id: string }).id);
  } else {
    await supabase.from('result_discrepancies').insert(row);
  }

  return { disagrees: true, recordedSide: verdict.recordedSide, derivedSide: verdict.derivedSide };
}

export { sideFromSummary };


/**
 * SC-433 · unsent play offered for a match that is already final.
 *
 * The other direction of the same argument, and the one a single check at upload
 * time misses. A scorer hands their ball-by-ball to one carrier and their result
 * to another; the result lands first and completes the match; the events then
 * arrive and are refused, because a finished match is immutable (SC-42) and
 * reopening one behind everybody's back would be far worse than refusing.
 *
 * But refusing quietly would leave a recorded result with unsent play behind it
 * and nobody any the wiser — which is the same silence this whole area exists to
 * remove. So the refusal is recorded as an argument for the organiser: this
 * fixture is final, and a scorer is still holding N actions for it.
 *
 * Deliberately NOT a comparison. Working out what those events "would have"
 * produced means inserting them, and that is exactly the thing we are declining
 * to do. The honest signal is that the disagreement exists, not a number invented
 * to describe it.
 */
export async function recordUnsentPlayForFinalMatch(
  matchId: string,
  opCount: number,
): Promise<void> {
  const { data: match } = await supabase
    .from('matches')
    .select('id, tournament_id, team_a_id, team_b_id, winner_team_id, score_summary')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return;
  const m = match as {
    tournament_id: string | null; team_a_id: string | null; team_b_id: string | null;
    winner_team_id: string | null; score_summary: unknown;
  };

  const { data: open } = await supabase
    .from('result_discrepancies')
    .select('id').eq('match_id', matchId).is('resolved_at', null).maybeSingle();
  if (open) return; // one open argument per match is enough

  await supabase.from('result_discrepancies').insert({
    match_id: matchId,
    tournament_id: m.tournament_id,
    recorded_winner_team_id: m.winner_team_id,
    recorded_side: sideOfTeam({ team_a_id: m.team_a_id, team_b_id: m.team_b_id }, m.winner_team_id),
    // No derived side: nothing was derived, and inventing one would be a lie.
    derived_winner_side: null,
    recorded_summary: m.score_summary ?? null,
    derived_summary: { unsent_actions: opCount },
    detected_by: 'events',
  });
}
