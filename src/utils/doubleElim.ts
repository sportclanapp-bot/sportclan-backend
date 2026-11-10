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

/**
 * N-R7-253 (Step 2 B10, SPP2-VOL-015) · the back draw, the final and the reset
 * on the schedule's own clock: after the main draw (rounds 1…k) each back round,
 * then the final, then the reset is one more scheduler round, so they take the
 * courts and day hours like every other match (they were the main final's time
 * plus a round's gap, all of a round at one time, at night). These are the
 * scheduler's round numbers (`scheduleRound`), not the stored ones.
 */
export function scheduleRound(k: number, bracket: 'back' | 'final' | 'reset', round: number): number {
  const back = 2 * Math.max(0, k - 1);
  if (bracket === 'back') return k + round;
  return bracket === 'final' ? k + back + 1 : k + back + 2;
}

/** N-R7-253 · the slots to schedule for the back draw, the final and the reset (no teams yet). */
export function deScheduleShape(k: number, byes?: Map<string, 'bye' | 'empty'>): Array<{ round: number; match_no: number; team_a_id: null; team_b_id: null }> {
  const out: Array<{ round: number; match_no: number; team_a_id: null; team_b_id: null }> = [];
  // N-R7-259: a back-draw place a main-draw bye leaves without a match is decided without play — no slot.
  backRounds(k).forEach((n, i) => { for (let m = 0; m < n; m++) if (!byes?.has(`${i + 1}:${m}`)) out.push({ round: scheduleRound(k, 'back', i + 1), match_no: m, team_a_id: null, team_b_id: null }); });
  out.push({ round: scheduleRound(k, 'final', 0), match_no: 0, team_a_id: null, team_b_id: null });
  out.push({ round: scheduleRound(k, 'reset', 0), match_no: 0, team_a_id: null, team_b_id: null });
  return out;
}

/**
 * N-R7-259 (Step 2 B10, SPP2-CRI-015) · the back-draw matches a main-draw bye leaves without a match, known at
 * the draw: `${round}:${matchNo}` → 'bye' (one team only: it goes through without play) or 'empty' (no team:
 * not played). `round1Bye[m]`: main round-1 match m is a bye (it has no loser). Every later main-draw match has a loser.
 */
export function backByes(k: number, round1Bye: boolean[]): Map<string, 'bye' | 'empty'> {
  const out = new Map<string, 'bye' | 'empty'>();
  if (k <= 1) return out;
  const counts = backRounds(k);
  const real = new Map<string, number>(); // `${round}:${matchNo}` → teams that can reach it
  const add = (r: number, m: number, n: number) => real.set(`${r}:${m}`, (real.get(`${r}:${m}`) ?? 0) + n);
  for (let r = 1; r <= k; r++) {
    const inRound = Math.pow(2, k - r);
    for (let m = 0; m < inRound; m++) {
      const t = loserTarget(k, r, m);
      if (t.bracket === 'back') add(t.round, t.matchNo, r === 1 && round1Bye[m] ? 0 : 1);
    }
  }
  counts.forEach((n, i) => {
    const r = i + 1;
    for (let m = 0; m < n; m++) {
      const have = real.get(`${r}:${m}`) ?? 0;
      if (have < 2) out.set(`${r}:${m}`, have === 1 ? 'bye' : 'empty');
      const nx = backNext(k, r, m);
      if (nx.bracket === 'back') add(nx.round, nx.matchNo, have > 0 ? 1 : 0);
    }
  });
  return out;
}
