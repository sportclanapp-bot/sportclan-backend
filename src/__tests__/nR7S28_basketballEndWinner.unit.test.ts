/**
 * N-R7-S28 (Step 2 · Batch 11): a scored basketball game could be ended for
 * the side that was behind — 2–3 completed as "Bulls won 3–2" (the result even
 * swapped the score). The named winner must be the side ahead. A level score
 * with a declared winner stays allowed (K2-40: a forfeit / recorded result).
 */
import { basketballEndRefusal } from '../utils/pointsGameEnd';

const s = (a: number, b: number, periods = [{ A: a, B: b }]) => ({ A: { score: a, points: a }, B: { score: b, points: b }, periods });
const names = { A: 'Bulls', B: 'Hawks' };

test('level with a declared winner is the organiser’s call (K2-40)', () => {
  expect(basketballEndRefusal(s(70, 70), 'A', names)).toBeNull();
});
test('the named winner must be ahead', () => {
  expect(basketballEndRefusal(s(2, 3), 'A', names)).toEqual({ error: 'The score says Hawks won this match.', code: 'WINNER_NOT_LEADER' });
});
test('the leader, or a result with no play at all, is fine', () => {
  expect(basketballEndRefusal(s(68, 64), 'A', names)).toBeNull();
  expect(basketballEndRefusal({}, 'A', names)).toBeNull();
  expect(basketballEndRefusal({ A: { score: 0 }, B: { score: 0 }, periods: [] }, 'B', names)).toBeNull();
});
