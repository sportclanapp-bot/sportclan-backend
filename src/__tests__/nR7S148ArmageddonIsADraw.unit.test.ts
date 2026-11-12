/**
 * N-R7-S148 (Step 2 Batch 13, FMT-CHS-DE-06) · a chess knockout game drawn on the board and settled
 * by a tie-break (Armageddon: score 0.5–0.5, winner_team_id set so the bracket moves on) is a draw in
 * the leaders' W–L record ('…D'), not a win and a loss. Before: P04 read '1W–1L'.
 */
import { sportBoards } from '../utils/sportLeaders';

const m = (id: string, a: string, b: string, w: string, extra: Record<string, unknown> = {}) => ({ id, team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', result_type: 'decisive',
  score_summary: { A: { score: w === a ? 1 : 0 }, B: { score: w === b ? 1 : 0 }, ...extra } });
const arm = (id: string, a: string, b: string, w: string) => ({ ...m(id, a, b, w), score_summary: { A: { score: 0.5 }, B: { score: 0.5 }, chess_tiebreak: { method: 'armageddon', armageddon: 'draw', winner_side: w === a ? 'A' : 'B', white: 'B' } } });
const M = [m('sf1', 'A', 'B', 'A'), arm('sf2', 'C', 'D', 'C'), arm('f', 'A', 'C', 'A')];

test('the Armageddon-settled games count as draws; plain wins and losses as before', () => {
  const wins = sportBoards('chess', M as never, { A: 'A', B: 'B', C: 'C', D: 'D' }).find((b) => b.stat === 'wins')!;
  expect(wins.rows.map((r) => `${r.name} ${r.detail}`)).toEqual(['A 1W–0L–1D']);
});
