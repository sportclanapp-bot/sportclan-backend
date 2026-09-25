/**
 * SC-441 (M1) · the result sentence, derived in ONE place.
 *
 * It used to be derived in three, and they disagreed about the same match:
 *
 *   Result screen   "QA943 XI won by 10 wickets"   ← correct
 *   Match Detail    "QA943 XI won by 2 runs"       ← the raw score difference
 *   Team insights   "1 DREW"                       ← a third signal entirely
 *
 * The server's version (matches.controller, completeMatch) had no wickets branch
 * at all: for cricket it was always `won by ${hi - lo} runs`. That is the margin
 * a side wins by when it DEFENDS a total. A side that successfully CHASES wins
 * by the wickets it had left — the runs difference is meaningless there, and for
 * a chase completed with a boundary it is not even the real gap.
 *
 * The app screen had the good logic (toss-aware, wickets-aware) and the server
 * had the authority. This moves the good logic to the authority, so every
 * surface reads one persisted sentence instead of inventing its own.
 *
 * A tie is "Tied", never "won by 0 runs" — see decideWinnerSide.
 */

import { dlsOutcome } from './cricketRules';

export type Side = 'A' | 'B';

export interface ResultInput {
  /** Normalised sport slug, e.g. 'cricket', 'tabletennis'. */
  sport: string;
  teamAName: string;
  teamBName: string;
  aScore: number;
  bScore: number;
  /** Cricket only: wickets lost by each side. */
  aWickets?: number;
  bWickets?: number;
  /** A6: wickets that end each side's innings (cricketRules.allOutBySide); default 10. */
  aAllOut?: number;
  bAllOut?: number;
  /** Which side won the toss, when known (works for free-text teams). */
  tossWinnerSide?: Side | null;
  /** 'bat' | 'bowl' — what the toss winner chose. */
  tossChoice?: string | null;
  /** An explicitly supplied winner, e.g. a walkover or an umpire decision. */
  explicitWinner?: Side | null;
  /**
   * F-15 · cricket: the side on the first delivery (score_summary
   * .first_batting_side). Tells who chased when no toss was recorded — "by
   * wickets" used to need a toss, so a chase without one read "won by N runs".
   */
  firstBattingSide?: Side | null;
  /** F-15 · cricket: a DLS revised target for the chasing side (score_summary.dls_target). */
  dlsTarget?: number | null;
}

const SET_SPORTS = new Set(['badminton', 'tennis', 'tabletennis', 'pickleball', 'volleyball']);

/** Sports whose "score" is sets won rather than points. */
export const isSetSport = (sport: string): boolean => SET_SPORTS.has(sport);

/**
 * Who won, or null for a tie.
 *
 * An explicit winner is honoured ONLY when the scores are not level. That is the
 * fix for the observed "WINNER T70450 · won by 0 runs" on a 0/0 vs 0/0 match: a
 * supplied winner_team_id set the winner even at equal scores, so the tie branch
 * could never run and the margin came out as zero. A genuine forfeit is a
 * walkover and is labelled as one — it does not travel through here.
 */
export function decideWinnerSide(input: {
  aScore: number;
  bScore: number;
  explicitWinner?: Side | null;
}): Side | null {
  const { aScore, bScore, explicitWinner } = input;
  // F-03 (confirmed live, session 1): a NAMED winner is the result even when the
  // scores are level or absent — a result entered without a score, or a singles
  // match completed at 0-0 with its winner. Ignoring it stored "Tied"/draw while
  // Elo, W/L and the bracket had already counted the named winner, so the record
  // and the result disagreed (and a later void reversed a draw, not the win).
  // The margin is what SC-441 guarded against ("won by 0 runs"); deriveResultText
  // leaves the margin out when the scores are level.
  if (explicitWinner === 'A' || explicitWinner === 'B') return explicitWinner;
  if (aScore === bScore) return null;
  return aScore > bScore ? 'A' : 'B';
}

/**
 * Which side batted second, or null when the toss is unknown.
 *
 * The toss winner who elected to BAT bats first, so the other side chases; if
 * they elected to BOWL, the toss winner chases.
 */
export function chasingSide(
  tossWinnerSide?: Side | null,
  tossChoice?: string | null,
  firstBattingSide?: Side | null,
): Side | null {
  // F-15: no toss recorded — the side that did NOT bat first chased.
  const fromPlay = firstBattingSide === 'A' ? 'B' : firstBattingSide === 'B' ? 'A' : null;
  if (tossWinnerSide !== 'A' && tossWinnerSide !== 'B') return fromPlay;
  if (tossChoice !== 'bat' && tossChoice !== 'bowl') return fromPlay;
  if (tossChoice !== 'bat' && tossChoice !== 'bowl') return null;
  if (tossChoice === 'bat') return tossWinnerSide === 'A' ? 'B' : 'A';
  return tossWinnerSide;
}

/**
 * The full sentence, e.g. "QA943 XI won by 10 wickets" / "Tied".
 *
 * Cricket:
 *   chased and won  → by the wickets still in hand (10 − wickets lost)
 *   defended a total → by the runs difference
 *   level            → "Tied"
 * Chess reports no margin. Set sports and everything else report the score.
 */
export function deriveResultText(input: ResultInput): {
  text: string;
  winnerSide: Side | null;
} {
  const { sport, teamAName, teamBName, aScore, bScore } = input;
  const dls = sport === 'cricket' ? dlsResult(input) : null;
  if (dls) return dls;
  const winnerSide = decideWinnerSide(input);

  if (!winnerSide) {
    // One word, and the same word everywhere. The old server text was
    // "Match Draw 0-0" while the app said "Match tied" and insights said "DREW".
    return { text: sport === 'chess' ? 'Draw' : 'Tied', winnerSide: null };
  }

  const winnerName = winnerSide === 'A' ? teamAName : teamBName;
  // Level (or no) score with a named winner: say who won, with no margin.
  if (aScore === bScore) return { text: `${winnerName} won`, winnerSide };
  const hi = Math.max(aScore, bScore);
  const lo = Math.min(aScore, bScore);
  const diff = hi - lo;

  if (sport === 'chess') return { text: `${winnerName} won`, winnerSide };

  if (sport === 'cricket') {
    const chased = chasingSide(input.tossWinnerSide, input.tossChoice, input.firstBattingSide);
    if (chased !== null && chased === winnerSide) {
      return { text: `${winnerName} won by ${wicketsInHand(input, winnerSide)}`, winnerSide };
    }
    return { text: `${winnerName} won by ${diff} run${diff === 1 ? '' : 's'}`, winnerSide };
  }

  // Set sports report sets won; everything else reports goals/points/boards.
  return { text: `${winnerName} won ${hi}-${lo}`, winnerSide };
}

function wicketsInHand(input: ResultInput, side: Side): string {
  const lost = (side === 'A' ? input.aWickets : input.bWickets) ?? 0;
  const allOut = (side === 'A' ? input.aAllOut : input.bAllOut) ?? 10;
  const remaining = Math.max(0, allOut - lost);
  return `${remaining} wicket${remaining === 1 ? '' : 's'}`;
}

/**
 * F-15 · the DLS winner of a cricket match, or null when DLS doesn't apply (no
 * target, or nobody can say who chased). Exported so completion can check the
 * named winner against it.
 */
export function dlsWinner(input: Pick<ResultInput, 'aScore' | 'bScore' | 'tossWinnerSide' | 'tossChoice' | 'firstBattingSide' | 'dlsTarget'>):
  { winnerSide: Side | null; runs: number; chaser: Side } | null {
  const chaser = chasingSide(input.tossWinnerSide, input.tossChoice, input.firstBattingSide);
  if (!chaser) return null;
  const o = dlsOutcome(chaser === 'A' ? input.aScore : input.bScore, input.dlsTarget);
  if (!o) return null;
  const defender: Side = chaser === 'A' ? 'B' : 'A';
  return { winnerSide: o.winner === 'chaser' ? chaser : o.winner === 'defender' ? defender : null, runs: o.runs, chaser };
}

function dlsResult(input: ResultInput): { text: string; winnerSide: Side | null } | null {
  const d = dlsWinner(input);
  if (!d) return null;
  if (!d.winnerSide) return { text: 'Tied (DLS)', winnerSide: null };
  const name = d.winnerSide === 'A' ? input.teamAName : input.teamBName;
  if (d.winnerSide === d.chaser) return { text: `${name} won by ${wicketsInHand(input, d.winnerSide)} (DLS)`, winnerSide: d.winnerSide };
  return { text: `${name} won by ${d.runs} run${d.runs === 1 ? '' : 's'} (DLS)`, winnerSide: d.winnerSide };
}
