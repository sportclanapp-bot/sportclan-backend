/**
 * Badminton gap 10 (Oct 2026) · BWF's group order: matches won (the points) →
 * head-to-head → games difference → points difference (rally points won minus
 * lost, from every game's score), as a tie-break and a badminton preset.
 */
import { computeStats, rankTeams, rallyPointsOf } from '../utils/standings';
import { tiebreakPresetsFor, tiebreaksFor, tiebreakLabel, tiebreakRefusal, storedTiebreaks } from '../utils/tournamentSettings';

const m = (a: string, b: string, w: string, as: number[], bs: number[]) => ({
  team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed',
  score_summary: { A: { score: as.filter((x, i) => x > bs[i]!).length, sets: as }, B: { score: bs.filter((x, i) => x > as[i]!).length, sets: bs } },
});
// A, B, C each win one; each 2–1 in games → level on matches, H2H a circle, games diff 0 — points decide.
const MS = [
  m('A', 'B', 'A', [21, 15, 21], [10, 21, 19]), // A +7
  m('B', 'C', 'B', [21, 18, 21], [19, 21, 15]), // B +5
  m('C', 'A', 'C', [21, 19, 22], [17, 21, 20]), // C +4
];

test('rally points from each game; a walkover has none', () => {
  expect(rallyPointsOf(MS[0] as never)).toEqual({ a: 57, b: 50 });
  expect(rallyPointsOf({ score_summary: { walkover: true, A: { sets: [21] }, B: { sets: [0] } } } as never)).toEqual({ a: 0, b: 0 });
  const t = computeStats(['A', 'B', 'C'], MS as never);
  expect(['A', 'B', 'C'].map((id) => t.get(id)!.rallyDiff)).toEqual([7 - 4, 5 - 7, 4 - 5].map((x) => x));
});

test('the BWF order: level on matches, H2H a circle, games level → points difference decides', () => {
  const bwf = tiebreakPresetsFor('badminton').find((p) => p.key === 'bwf')!;
  expect(bwf).toEqual({ key: 'bwf', label: 'BWF (head-to-head, games, points)', order: ['head_to_head', 'score_diff', 'points_diff'] });
  expect(rankTeams(['A', 'B', 'C'], MS as never, bwf.order)).toEqual(['A', 'C', 'B']);
});

test('offered for the rally sports, named, checked and stored', () => {
  expect(tiebreaksFor('badminton')).toContain('points_diff');
  expect(tiebreaksFor('pickleball')).toContain('points_diff');
  expect(tiebreaksFor('cricket')).not.toContain('points_diff');
  expect(tiebreakLabel('badminton', 'points_diff')).toBe('Points difference');
  expect(tiebreakRefusal('badminton', ['head_to_head', 'points_diff'])).toBeNull();
  expect(tiebreakRefusal('football', ['points_diff'])!.error).toBe('Points difference isn’t a tie-break for this sport.');
  expect(storedTiebreaks(['h2h', 'point_difference'])).toEqual(['head_to_head', 'points_diff']);
});
