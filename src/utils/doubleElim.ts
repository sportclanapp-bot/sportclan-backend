/**
 * Stage 11 · PB4 (Oct 2026) · the shape of a double-elimination draw, every
 * knockout sport (USA Pickleball 15.B.1; club and school events).
 *
 * The main draw is the usual bracket of 2^k places (rounds 1…k). Its losers
 * drop into a BACK draw of 2(k−1) rounds:
 *   back round 1          the main round 1 losers, paired (2^(k−2) matches);
 *   back round 2j         back round 2j−1's winners (slot A) against the main
 *                         round j+1 losers (slot B), dropped in reverse order so
 *                         players who met in the main draw don't meet again at once;
 *   back round 2j+1       back round 2j's winners, paired.
 * The back draw's winner meets the main draw's winner in the FINAL (main = A,
 * back = B). If the back-draw side wins it, both have lost once: a RESET final
 * is played. Two entries: no back draw — the main final's loser goes to the final.
 *
 * Rounds are stored per bracket: `round` 1…k for the main draw (bracket NULL),
 * 1…2(k−1) for the back draw (bracket 'back'); the final is round k+1 ('final')
 * and the reset k+2 ('reset').
 */

export type Slot = 'A' | 'B';

/** Matches in each back-draw round for a main draw of 2^k places (k ≥ 1). */
export function backRounds(k: number): number[] {
  const out: number[] = [];
  for (let j = 1; j <= k - 1; j++) {
    const n = Math.pow(2, k - 1 - j);
    out.push(n, n); // round 2j−1 and round 2j
  }
  return out;
}

/** Where the loser of main round `round`, match `matchNo` goes: a back-draw match, or (two entries) the final. */
export function loserTarget(k: number, round: number, matchNo: number): { bracket: 'back' | 'final'; round: number; matchNo: number; slot: Slot } {
  if (k <= 1) return { bracket: 'final', round: 2, matchNo: 0, slot: 'B' };
  if (round === 1) return { bracket: 'back', round: 1, matchNo: Math.floor(matchNo / 2), slot: matchNo % 2 === 0 ? 'A' : 'B' };
  const r = 2 * (round - 1);
  const count = backRounds(k)[r - 1] ?? 1;
  return { bracket: 'back', round: r, matchNo: count - 1 - matchNo, slot: 'B' };
}

/** Where the winner of back round `round`, match `matchNo` goes: the next back match, or the final (slot B). */
export function backNext(k: number, round: number, matchNo: number): { bracket: 'back' | 'final'; round: number; matchNo: number; slot: Slot } {
  const last = 2 * (k - 1);
  if (round >= last) return { bracket: 'final', round: k + 1, matchNo: 0, slot: 'B' };
  if (round % 2 === 1) return { bracket: 'back', round: round + 1, matchNo, slot: 'A' };
  return { bracket: 'back', round: round + 1, matchNo: Math.floor(matchNo / 2), slot: matchNo % 2 === 0 ? 'A' : 'B' };
}

/** "Back draw round 2", "Back draw final" — a back-draw round's name. */
export function backRoundName(k: number, round: number): string {
  return round >= 2 * (k - 1) ? 'Back draw final' : `Back draw round ${round}`;
}
