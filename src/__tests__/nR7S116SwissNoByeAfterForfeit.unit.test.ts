/**
 * N-R7-S116 (SPP1-CHS-137, Step 2 B8): the player who didn't turn up (forfeit loss) was given the
 * very next round's pairing bye — a free point for not showing. The bye now goes to the next
 * eligible player; the forfeit winner still can't take it either (SP-CHS-139).
 */
import { dutchHistory, dutchRound } from '../utils/swissDutch';

const P = ['P1', 'P2', 'P3', 'P4', 'P5'];
const r1 = [
  { round: 1, white: 'P1', black: 'P2', winner: 'P1' },
  { round: 1, white: 'P3', black: 'P4', forfeit: true, winner: 'P3' }, // P4 absent
  { round: 1, white: 'P5', black: null, bye: true },
];
const pts = new Map([['P1', 1], ['P3', 1], ['P5', 1], ['P2', 0], ['P4', 0]]);
const tpn = new Map(P.map((p, i) => [p, i + 1]));

test("round 2's bye skips the absent P4 (and P3, who won by forfeit, and P5, who had it)", () => {
  const history = dutchHistory(P, r1, () => 0);
  expect(history.get('P4')!.noBye).toBe(true);
  expect(history.get('P3')!.noBye).toBe(true);
  const r = dutchRound({ players: P, points: pts, history, tpn, colours: true, lastRound: false, winPoints: 1, roundsPlayed: 1 });
  expect(r.bye).toBe('P2');
  expect(r.pairs.flatMap((x) => [x.white, x.black])).toContain('P4');
});

test('only the round right after: an older forfeit loss leaves the player eligible again', () => {
  const r2 = [...r1, { round: 2, white: 'P1', black: 'P3', winner: 'P1' }, { round: 2, white: 'P4', black: 'P5', winner: 'P5' }, { round: 2, white: 'P2', black: null, bye: true }];
  expect(dutchHistory(P, r2, () => 0).get('P4')!.noBye).toBe(false);
});
