/**
 * SC-433 · does the recorded result agree with the play?
 *
 * A hub can carry a RESULT signed by a scorer ("A won 21-19") while that same
 * scorer's phone is still holding the ball-by-ball. The two arrive separately and
 * can disagree. The server cannot know which is right — the events may be
 * incomplete, or the result may have been recorded on the wrong court — so it
 * does not choose. It detects, records, and hands the argument to a human.
 *
 * Pure on purpose. This is the rule a tournament's outcome turns on, so it is
 * testable without a database, and every caller asks it the same way.
 */

export type Side = 'A' | 'B' | 'draw';

/**
 * Which side the PLAY says is ahead.
 *
 * `A.score` / `B.score` is the one field every sport's summary agrees on —
 * sets for badminton and tennis, runs for cricket, goals for football, 1/0 for
 * chess — and it is the same field the standings ladder reads. Anything
 * sport-specific belongs in recomputeSummary, not here.
 *
 * `null` means "the events do not say", which is NOT the same as a draw and must
 * never be treated as one: a match with no events at all, or a summary that was
 * never computed, has no opinion to disagree with.
 */
export function sideFromSummary(summary: unknown): Side | null {
  if (!summary || typeof summary !== 'object') return null;
  const s = summary as Record<string, { score?: unknown } | undefined>;
  const a = num(s.A?.score);
  const b = num(s.B?.score);
  if (a === null || b === null) return null;
  if (a === b) return 'draw';
  return a > b ? 'A' : 'B';
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Which side a winning team id corresponds to on this match. */
export function sideOfTeam(
  match: { team_a_id?: string | null; team_b_id?: string | null },
  winnerTeamId: string | null | undefined,
): Side | null {
  if (!winnerTeamId) return 'draw';
  if (match.team_a_id && winnerTeamId === match.team_a_id) return 'A';
  if (match.team_b_id && winnerTeamId === match.team_b_id) return 'B';
  // A winner that is neither side is not a disagreement about who won; it is a
  // broken record, and saying "the events disagree" would be the wrong story.
  return null;
}

export interface DiscrepancyVerdict {
  disagrees: boolean;
  recordedSide: Side | null;
  derivedSide: Side | null;
  /** Why no comparison was made, when none was. Kept so callers can log the
   *  reason rather than a bare false. */
  skipped?: 'no_events' | 'not_final' | 'unknown_winner' | 'free_text';
}

/**
 * Compare a recorded result against what the events add up to.
 *
 * Only meaningful once the match is FINAL. Mid-match the events are incomplete by
 * definition, and a half-played game whose current leader differs from the
 * eventual winner is the ordinary case, not a problem — firing there would cry
 * wolf on every comeback and teach organisers to ignore the warning.
 */
export function checkResultAgainstPlay(args: {
  matchStatus: string | null | undefined;
  isTerminal: (status: string | null | undefined) => boolean;
  teamAId?: string | null;
  teamBId?: string | null;
  recordedWinnerTeamId: string | null | undefined;
  /** True when the match HAS a decided result, so a null winner means a draw
   *  rather than "not decided yet". */
  hasRecordedResult: boolean;
  derivedSummary: unknown;
  eventCount: number;
}): DiscrepancyVerdict {
  const recordedSide = args.hasRecordedResult
    ? sideOfTeam({ team_a_id: args.teamAId, team_b_id: args.teamBId }, args.recordedWinnerTeamId)
    : null;
  const derivedSide = sideFromSummary(args.derivedSummary);

  if (!args.isTerminal(args.matchStatus)) return { disagrees: false, recordedSide, derivedSide, skipped: 'not_final' };
  if (args.eventCount === 0) return { disagrees: false, recordedSide, derivedSide, skipped: 'no_events' };
  if (derivedSide === null) return { disagrees: false, recordedSide, derivedSide, skipped: 'no_events' };
  if (!args.hasRecordedResult) return { disagrees: false, recordedSide, derivedSide, skipped: 'unknown_winner' };
  // A free-text side has no team id, so "who won" cannot be expressed as a side
  // and there is nothing to compare. Guest matches still get their events; they
  // just cannot produce this particular argument.
  if (recordedSide === null) return { disagrees: false, recordedSide, derivedSide, skipped: 'free_text' };

  return { disagrees: recordedSide !== derivedSide, recordedSide, derivedSide };
}


/**
 * SC-433 · would recording THIS result contradict the play already on the server?
 *
 * Asked BEFORE the match is completed, which is the difference that matters. The
 * other check in this file looks at a match that already has a result; this one
 * looks at a result about to be written over events that are already here.
 *
 * Completing first and flagging afterwards would leave the match recording an
 * outcome its own ball-by-ball contradicts, with the argument raised after the
 * fact. "Never silently overwritten" has to mean the write does not happen.
 *
 * Status is deliberately NOT consulted. A result op is the thing that ends a
 * match, so waiting for it to be final would mean never checking at all.
 */
export function resultWouldContradictPlay(args: {
  teamAId?: string | null;
  teamBId?: string | null;
  claimedWinnerTeamId: string | null;
  currentSummary: unknown;
  eventCount: number;
}): DiscrepancyVerdict {
  const recordedSide = sideOfTeam(
    { team_a_id: args.teamAId, team_b_id: args.teamBId },
    args.claimedWinnerTeamId,
  );
  const derivedSide = sideFromSummary(args.currentSummary);

  if (args.eventCount === 0) return { disagrees: false, recordedSide, derivedSide, skipped: 'no_events' };
  if (derivedSide === null) return { disagrees: false, recordedSide, derivedSide, skipped: 'no_events' };
  // A free-text side cannot be named by team id, so there is nothing to compare.
  if (recordedSide === null) return { disagrees: false, recordedSide, derivedSide, skipped: 'free_text' };

  return { disagrees: recordedSide !== derivedSide, recordedSide, derivedSide };
}
