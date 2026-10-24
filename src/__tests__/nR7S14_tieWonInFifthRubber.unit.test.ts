/**
 * N-R7-S14 (Step 2, Batch 5, SPP1-TEN-121): with the set-score points template ({straight [3,0],
 * decider [2,1]}), a first-to-3 team tie won 3–2 — it went to its last rubber — scored as a straight
 * win (3 / 0). Only a tie with a deciding match (MLP's DreamBreaker) counted as 'decider'. A
 * first-to tie won by one rubber in its last match is the decider too (2 / 1); 3–0 and 3–1 stay 3 / 0.
 */
import { computeStats } from '../utils/standings';

const pts = { win: 1, draw: 0.5, loss: 0, noResult: null, walkoverWin: null, walkoverLoss: null, sets: { straight: [3, 0] as [number, number], decider: [2, 1] as [number, number] } };
const tie = (a: number, b: number) => ({ team_a_id: 'H', team_b_id: 'X', winner_team_id: a > b ? 'H' : 'X', status: 'completed', score_summary: { A: { score: a }, B: { score: b }, tie: { win: 'first', rubbersA: a, rubbersB: b, decided: a > b ? 'A' : 'B' } } });
test('a Davis Cup tie won 3–2 scores the decider points; 3–1 the straight ones', () => {
  const s = computeStats(['H', 'X'], [tie(3, 2)], undefined, pts as never);
  expect([s.get('H')!.points, s.get('X')!.points]).toEqual([2, 1]);
  const t = computeStats(['H', 'X'], [tie(3, 1)], undefined, pts as never);
  expect([t.get('H')!.points, t.get('X')!.points]).toEqual([3, 0]);
});
test('a tie with a deciding match still reads its flag; a tie by games is not a decider by one game', () => {
  const mlp = { ...tie(3, 2), score_summary: { ...tie(3, 2).score_summary, tie: { win: 'first', rubbersA: 3, rubbersB: 2, decided: 'A', decider: true } } };
  expect(computeStats(['H', 'X'], [mlp], undefined, pts as never).get('H')!.points).toBe(2);
  const games = { ...tie(20, 19), score_summary: { A: { score: 20 }, B: { score: 19 }, tie: { win: 'games', rubbersA: 2, rubbersB: 2, decided: 'A' } } };
  expect(computeStats(['H', 'X'], [games], undefined, pts as never).get('H')!.points).toBe(3);
});
