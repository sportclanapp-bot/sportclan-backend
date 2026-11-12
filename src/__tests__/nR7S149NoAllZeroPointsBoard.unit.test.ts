/**
 * N-R7-S149 (Step 2 Batch 13, SIDE-C4b-3) · results typed with a winner only (no game scores) gave
 * table tennis / pickleball / volleyball a 'Points difference' board whose rows were all '0–0 · 0',
 * while tennis already left its empty boards out. A board with no points at all is left out (no rows).
 */
import { sportBoards } from '../utils/sportLeaders';

const won = (id: string, a: string, b: string, w: string, ss: Record<string, unknown> = {}) => ({ id, team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', result_type: 'decisive', score_summary: ss });
const names = { A: 'A', B: 'B', C: 'C' };

test.each(['tabletennis', 'pickleball', 'volleyball', 'badminton'])('%s: winner-only results → no Points difference rows; Most wins kept', (sport) => {
  const bs = sportBoards(sport, [won('1', 'A', 'B', 'A'), won('2', 'B', 'C', 'B')] as never, names);
  expect(bs.find((b) => b.stat === 'points_diff')?.rows ?? []).toEqual([]);
  expect(bs.find((b) => b.stat === 'wins')!.rows.map((r) => r.detail)).toEqual(['1W–0L', '1W–1L']);
});

test('with game scores the Points difference board still lists every team that played (a 0–0 row included)', () => {
  const bs = sportBoards('tabletennis', [won('1', 'A', 'B', 'A', { A: { sets: [11, 11] }, B: { sets: [5, 7] } }), won('2', 'B', 'C', 'B')] as never, names);
  expect(bs.find((b) => b.stat === 'points_diff')!.rows.map((r) => `${r.name} ${r.detail}`)).toEqual(['A 22–12', 'C 0–0', 'B 12–22']);
});
