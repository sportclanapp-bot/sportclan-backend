/** N-R7-37 (Step 2, RW-R3C-098): 'The result stands' on a cricket match with no ball bowled has no score to stand on. */
import { scoreNow } from '../controllers/matchDecision.controller';

test('cricket with no ball bowled: no score (refused NO_SCORE, not a 0–0 tie)', () => {
  expect(scoreNow({ A: { runs: 0, balls: 0, score: 0, wickets: 0 }, B: { runs: 0, balls: 0, score: 0, wickets: 0 } })).toBeNull();
});
test('balls bowled, or a goal sport at 0–0: a score', () => {
  expect(scoreNow({ A: { runs: 12, balls: 12, score: 12 }, B: { runs: 0, balls: 0, score: 0 } })).toEqual({ A: 12, B: 0 });
  expect(scoreNow({ A: { score: 0 }, B: { score: 0 } })).toEqual({ A: 0, B: 0 });
});
