/**
 * N-R7-S9 (Step 2, Batch 5, SPP1-TEN-099): 'The result stands' on a tennis match abandoned before
 * its first point — only the warm-up recorded, so the stored score is sets 0–0 with nothing in them —
 * was completed as "Draw 0–0 (result stands)". Nothing was scored: there's no score to stand (NO_SCORE).
 */
import { scoreNow } from '../controllers/matchDecision.controller';

const none = { score: 0, sets: [], games: 0, points: 0 };
test('a set sport with nothing scored on either side: no score', () => {
  expect(scoreNow({ A: { ...none }, B: { ...none } })).toBeNull();
  expect(scoreNow({ A: { score: 0, sets: [] }, B: { score: 0, sets: [] } })).toBeNull();
});
test('a point, a game or a set played is a score', () => {
  expect(scoreNow({ A: { ...none, points: 1 }, B: { ...none } })).toEqual({ A: 0, B: 0 });
  expect(scoreNow({ A: { ...none, games: 2 }, B: { ...none, games: 1 } })).toEqual({ A: 0, B: 0 });
  expect(scoreNow({ A: { score: 1, sets: [6], games: 2, points: 0 }, B: { score: 0, sets: [4], games: 1, points: 0 } })).toEqual({ A: 1, B: 0 });
});
test('a goal sport at 0–0 is still a score', () => {
  expect(scoreNow({ A: { score: 0 }, B: { score: 0 } })).toEqual({ A: 0, B: 0 });
});
