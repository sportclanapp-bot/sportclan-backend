/**
 * U-29 · a decided rally match stays decided on the server too.
 *
 * The device run finished 21-17, 21-23, 21-15. The stored summary then carried an
 * empty fourth set (points 0-0), which the hub card and Match Detail showed as the
 * match's score, and any point after the decider would have been scored into it.
 */
import { rollupSets } from '../controllers/scoring.controller';

const BADMINTON = { target: 21, cap: 30, maxSets: 3, winBy2: true };
const sideOf = (p: { team_side?: string }) => (p?.team_side === 'B' ? 'B' : 'A') as 'A' | 'B';
const pt = (side: 'A' | 'B') => ({ event_type: 'score', payload: { team_side: side } });

/** Alternate to the loser's total, then the winner takes the rest. */
function game(a: number, b: number) {
  const w = a > b ? 'A' : 'B';
  const l = w === 'A' ? 'B' : 'A';
  const out = [];
  for (let i = 0; i < Math.min(a, b); i++) out.push(pt(w), pt(l));
  for (let i = 0; i < Math.abs(a - b); i++) out.push(pt(w));
  return out;
}

const match = [...game(21, 17), ...game(21, 23), ...game(21, 15)];

test('the device match rolls up to 2-1 with every game recorded', () => {
  const r = rollupSets(BADMINTON, match, sideOf);
  expect([r.setsA, r.setsB]).toEqual([2, 1]);
  expect(r.setScoresA).toEqual([21, 21, 21]);
  expect(r.setScoresB).toEqual([17, 23, 15]);
  expect(r.decided).toBe('A');
});

test('points after the decider are ignored, not scored into a 4th set', () => {
  const r = rollupSets(BADMINTON, [...match, pt('B'), pt('B')], sideOf);
  expect([r.curA, r.curB]).toEqual([0, 0]);
  expect(r.setScoresA).toHaveLength(3);
});

test('an undecided match still reports its in-progress game', () => {
  const r = rollupSets(BADMINTON, [...game(21, 17), pt('A'), pt('B'), pt('B')], sideOf);
  expect(r.decided).toBeNull();
  expect([r.curA, r.curB]).toEqual([1, 2]);
});
