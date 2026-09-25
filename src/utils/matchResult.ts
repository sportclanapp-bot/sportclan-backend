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
  /** Which side won the toss, when known (works for free-text teams). */
  tossWinnerSide?: Side | null;
  /** 'bat' | 'bowl' — what the toss winner chose. */
  tossChoice?: string | null;
  /** An explicitly supplied winner, e.g. a walkover or an umpire decision. */
  explicitWinner?: Side | null;
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
export function chasingSide(tossWinnerSide?: Side | null, tossChoice?: string | null): Side | null {
  if (tossWinnerSide !== 'A' && tossWinnerSide !== 'B') return null;
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
    const chased = chasingSide(input.tossWinnerSide, input.tossChoice);
    if (chased !== null && chased === winnerSide) {
      const lost = (winnerSide === 'A' ? input.aWickets : input.bWickets) ?? 0;
      const remaining = Math.max(0, 10 - lost);
      return {
        text: `${winnerName} won by ${remaining} wicket${remaining === 1 ? '' : 's'}`,
        winnerSide,
      };
    }
    return { text: `${winnerName} won by ${diff} run${diff === 1 ? '' : 's'}`, winnerSide };
  }

  // Set sports report sets won; everything else reports goals/points/boards.
  return { text: `${winnerName} won ${hi}-${lo}`, winnerSide };
}
