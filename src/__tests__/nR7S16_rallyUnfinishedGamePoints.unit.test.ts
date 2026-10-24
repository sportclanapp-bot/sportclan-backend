/**
 * N-R7-S16 (Step 2, Batch 6, SPP1-TTN-151): a table tennis (or any rally-sport) match that ends
 * inside a game — a retirement or a disqualification — keeps that game's points as the current
 * points (score_summary.A.points / B.points), outside `sets`. Those rallies were played: the
 * table's points, the Points difference board and the profile's points count them (the game
 * itself has no winner, so games won don't change). Asha retired at 2-1 (11-5, 8-11, 11-9) and
 * 7-3 in game 4: points 37–28, not 30–25.
 */
import { rallyPointsOf } from '../utils/standings';
import { racketStats } from '../utils/racketStats';
import { sportBoards } from '../utils/sportLeaders';

const ret = { A: { score: 2, sets: [11, 8, 11], points: 7 }, B: { score: 1, sets: [5, 11, 9], points: 3 }, retired: { side: 'A' }, winner_side: 'B' };
const M = { id: 'm1', team_a_id: 'P', team_b_id: 'Q', winner_team_id: 'Q', status: 'completed', result_type: 'retired', score_summary: ret };
test('the table: points 37–28', () => { expect(rallyPointsOf(M as never)).toEqual({ a: 37, b: 28 }); });
test('the profile: points 37–28, games 2–1', () => {
  const s = racketStats([M as never], new Map([['m1', 'A']]), new Map([['m1', 1]]));
  expect([s.points_won, s.points_lost, s.games_won, s.games_lost]).toEqual([37, 28, 2, 1]);
});
test('the Points difference board: +9 (37–28); Games won stays 2–1', () => {
  const b = sportBoards('tabletennis', [M as never], { P: 'P', Q: 'Q' });
  expect(b.find((x) => x.stat === 'points_diff')!.rows.find((r) => r.team_id === 'P')?.detail).toBe('37–28');
  expect(b.find((x) => x.stat === 'games')!.rows.find((r) => r.team_id === 'P')?.detail).toBe('2–1');
});
test('a finished match (points back at 0), a walkover and a tennis summary add nothing', () => {
  expect(rallyPointsOf({ ...M, score_summary: { A: { sets: [11, 11], points: 0 }, B: { sets: [5, 6], points: 0 } } } as never)).toEqual({ a: 22, b: 11 });
  expect(rallyPointsOf({ ...M, score_summary: { ...ret, walkover: true } } as never)).toEqual({ a: 0, b: 0 });
  expect(rallyPointsOf({ ...M, score_summary: { A: { sets: [6], games: 2, points: 3 }, B: { sets: [4], games: 1, points: 1 }, set_tiebreaks: [null] } } as never)).toEqual({ a: 8, b: 5 });
});
