/**
 * N-R7-S11 (Step 2, Batch 5, SP-TEN-177 / SPP1-TEN-103): a tennis match that ends inside a set — a
 * retirement, a default, or time called mid-set — keeps that set's games as the current games
 * (score_summary.A.games / B.games), not in the sets. The games played so far didn't count:
 * won 6-4, 2-1 ret. read 6–4 games on the profile, the table and the Games board instead of 8–5.
 */
import { rallyPointsOf } from '../utils/standings';
import { racketStats } from '../utils/racketStats';
import { sportBoards } from '../utils/sportLeaders';

// P won 6-4, 2-1 when Q retired (score_summary as the server stores it)
const ret = { A: { score: 1, sets: [6], games: 2, points: 0 }, B: { score: 0, sets: [4], games: 1, points: 0 }, set_tiebreaks: [null], tiebreak: false, retired: { side: 'B' }, winner_side: 'A' };
const M = { id: 'm1', team_a_id: 'P', team_b_id: 'Q', winner_team_id: 'P', status: 'completed', result_type: 'retired', score_summary: ret };

test('the table: games 8–5', () => {
  expect(rallyPointsOf(M as never)).toEqual({ a: 8, b: 5 });
});
test('the profile: games 8–5, sets 1–0', () => {
  const s = racketStats([M as never], new Map([['m1', 'A']]), new Map([['m1', 1]]));
  expect([s.points_won, s.points_lost, s.games_won, s.games_lost]).toEqual([8, 5, 1, 0]);
});
test('the Games won board: 8–5; Sets won stays 1–0', () => {
  const boards = sportBoards('tennis', [M as never], { P: 'P', Q: 'Q' });
  const games = boards.find((b) => b.stat === 'games')!; const sets = boards.find((b) => b.stat === 'sets')!;
  expect(games.rows.find((r) => r.team_id === 'P')?.detail).toBe('8–5');
  expect(sets.rows.find((r) => r.team_id === 'P')?.detail).toBe('1–0');
});
test('badminton and finished tennis sets are unchanged; a walkover adds nothing', () => {
  expect(rallyPointsOf({ ...M, score_summary: { A: { sets: [21, 21], points: 0 }, B: { sets: [15, 10], points: 0 } } } as never)).toEqual({ a: 42, b: 25 }); // a finished badminton match (its unfinished-game points: N-R7-S16)
  expect(rallyPointsOf({ ...M, score_summary: { A: { sets: [6, 6], games: 0 }, B: { sets: [4, 3], games: 0 }, set_tiebreaks: [null, null] } } as never)).toEqual({ a: 12, b: 7 });
  expect(rallyPointsOf({ ...M, score_summary: { ...ret, walkover: true } } as never)).toEqual({ a: 0, b: 0 });
});
