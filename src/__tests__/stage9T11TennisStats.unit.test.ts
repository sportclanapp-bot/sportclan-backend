/**
 * Stage 9 · T11 · tennis boards (games, tiebreaks, aces), the "Most aces"
 * award, and the profile's serve stats (they read 0: the columns were never
 * written — now from each match's serve stats).
 */
import { sportBoards } from '../utils/sportLeaders';
import { computedAwards } from '../controllers/awards.controller';
import { racketStats, tennisServeStats } from '../utils/racketStats';

const T = { a: 'Ravi', b: 'Amit', c: 'Sam' };
const m = (id: string, a: string, b: string, A: number[], B: number[], tbs: Array<{ A: number; B: number } | null>, aces: [number, number], df: [number, number] = [0, 0]) => ({
  id, team_a_id: a, team_b_id: b, winner_team_id: A.filter((g, i) => g > B[i]!).length > B.filter((g, i) => g > A[i]!).length ? a : b,
  score_summary: { A: { score: 0, sets: A }, B: { score: 0, sets: B }, set_tiebreaks: tbs, serve: { A: { aces: aces[0], double_faults: df[0] }, B: { aces: aces[1], double_faults: df[1] } } },
});
const matches = [
  m('1', 'a', 'b', [7, 6], [6, 4], [{ A: 7, B: 5 }, null], [5, 1], [1, 3]),
  m('2', 'b', 'c', [6, 6, 1], [4, 7, 0], [null, { A: 5, B: 7 }, { A: 10, B: 8 }], [2, 4]),
];

test('boards: wins, sets, games, tiebreaks (a match tiebreak counts), aces', () => {
  const b = sportBoards('tennis', matches as never, T);
  expect(b.map((x) => x.stat)).toEqual(['wins', 'sets', 'games', 'tiebreaks', 'aces']);
  const rows = (st: string) => b.find((x) => x.stat === st)!.rows.map((r) => [r.name, r.value, r.detail]);
  expect(rows('games')).toEqual([['Amit', 23, '23–24'], ['Ravi', 13, '13–10'], ['Sam', 11, '11–13']]);
  // all won one; fewer lost first
  expect(rows('tiebreaks')).toEqual([['Ravi', 1, '1–0'], ['Sam', 1, '1–1'], ['Amit', 1, '1–2']]);
  expect(rows('aces')[0]).toEqual(['Ravi', 5, '1 match']);
});

test('the "Most aces" award; none when nobody served an ace', () => {
  const b = sportBoards('tennis', matches as never, T);
  const aw = computedAwards('tennis', b as never, null, [], new Map());
  expect(aw.map((x) => [x.title, x.winners.map((w) => w.name), x.value])).toEqual([['Most aces', ['Ravi'], '5 aces']]);
  const none = sportBoards('tennis', [m('3', 'a', 'b', [6, 6], [0, 0], [null, null], [0, 0])] as never, T);
  expect(computedAwards('tennis', none as never, null, [], new Map())).toEqual([]);
});

test('profile: sets and games won–lost, singles aces the player’s own, doubles the pair’s', () => {
  const side = new Map<string, 'A' | 'B'>([['1', 'B'], ['2', 'A']]);
  const size = new Map<string, number>([['1', 1], ['2', 2]]);
  const rk = racketStats(matches as never, side, size);
  expect([rk.games_won, rk.games_lost, rk.points_won, rk.points_lost, rk.singles_lost, rk.doubles_won]).toEqual([2, 3, 23, 24, 1, 1]);
  expect(tennisServeStats(matches as never, side, size)).toEqual({ aces: 1, double_faults: 3, doubles_aces: 2, doubles_double_faults: 0 });
});
