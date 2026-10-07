/**
 * Stage 9 · T4 · games in the table: tennis's games won, games %, matches
 * played (ATP Finals), for every sport scored in sets (rally points there).
 */
import { rankTeams, computeStats } from '../utils/standings';
import { tiebreaksFor, tiebreakLabel, tiebreakPresetsFor, tiebreakRefusal } from '../utils/tournamentSettings';

// A tennis match: winner, and games per set (A's sets, B's sets).
const t = (id: string, a: string, b: string, A: number[], B: number[]) => {
  const setsA = A.filter((g, i) => g > B[i]!).length; const setsB = B.filter((g, i) => g > A[i]!).length;
  return { id, team_a_id: a, team_b_id: b, winner_team_id: setsA > setsB ? a : b, status: 'completed', score_summary: { A: { score: setsA, sets: A }, B: { score: setsB, sets: B } } } as any;
};

test('three on 2 wins: total games won decides (Maharashtra inter-club)', () => {
  // X beat Y, Y beat Z, Z beat X — each 2 wins of 4 with W losing all; games differ.
  const m = [
    t('1', 'X', 'Y', [6, 6], [4, 4]), t('2', 'Y', 'Z', [6, 6], [0, 1]), t('3', 'Z', 'X', [7, 6], [6, 4]),
    t('4', 'X', 'W', [6, 6], [0, 0]), t('5', 'Y', 'W', [6, 6], [2, 2]), t('6', 'Z', 'W', [6, 6], [3, 3]),
  ];
  const s = computeStats(['X', 'Y', 'Z', 'W'], m);
  expect(['X', 'Y', 'Z'].map((id) => s.get(id)!.rallyFor)).toEqual([34, 32, 26]);
  expect(rankTeams(['X', 'Y', 'Z', 'W'], m, ['points_won'])).toEqual(['X', 'Y', 'Z', 'W']);
  // games %: Y 32/(32+17)=.653, X 34/(34+21)=.618, Z 26/(26+28)=.481 — a different order from total games
  expect(rankTeams(['Z', 'Y', 'X', 'W'], m, ['points_pct'])).toEqual(['Y', 'X', 'Z', 'W']);
});

test('ATP Finals: more matches played ranks a 2-1 above a 2-0 (a withdrawal)', () => {
  const m = [t('1', 'P', 'Q', [6, 6], [1, 1]), t('2', 'P', 'R', [6, 6], [1, 1]), t('3', 'Q', 'R', [6, 6], [2, 2]), t('4', 'S', 'P', [6, 6], [4, 4]), t('5', 'S', 'Q', [6, 6], [4, 4])];
  // P 2-1, S 2-0 (withdrew before playing R)
  expect(rankTeams(['S', 'P', 'Q', 'R'], m, ['wins', 'played', 'head_to_head']).slice(0, 2)).toEqual(['P', 'S']);
});

test('who offers what, and the words', () => {
  expect(tiebreaksFor('tennis')).toEqual(expect.arrayContaining(['played', 'points_diff', 'points_won', 'points_pct']));
  expect(tiebreaksFor('badminton')).toEqual(expect.arrayContaining(['points_won', 'points_pct']));
  expect(tiebreaksFor('badminton')).not.toContain('played');
  expect(tiebreaksFor('football')).not.toContain('points_won');
  expect([tiebreakLabel('tennis', 'points_won'), tiebreakLabel('tennis', 'points_pct'), tiebreakLabel('tennis', 'points_diff'), tiebreakLabel('tennis', 'score_ratio')]).toEqual(['Games won', 'Games won %', 'Game difference', 'Sets won %']);
  expect(tiebreakLabel('volleyball', 'points_won')).toBe('Points won');
  expect(tiebreakPresetsFor('tennis').map((p) => p.key)).toEqual(['default', 'atp', 'games']);
  expect(tiebreakRefusal('tennis', ['wins', 'played', 'head_to_head', 'score_ratio', 'points_pct'])).toBeNull();
  expect(tiebreakRefusal('football', ['points_won'])?.error).toMatch(/isn’t a tie-break for this sport/);
});
