/**
 * N-Q070 (launch test plan, Round 2): a volleyball walkover went down 2–0 in sets with no points, so
 * the points-ratio tie-breaks ignored it — the plan says a beach walkover is 2–0 (21–0). Each set is
 * now its target to nil (indoor 25–0), and the table counts those points.
 */
import { withWalkoverScore } from '../utils/walkoverScore';
import { computeStats } from '../utils/standings';
import { pointsPresetFor } from '../utils/tournamentSettings';

const beach = { bestOf: 3, target: 21, finalTarget: 15, players: 2 } as never;
const indoor = { bestOf: 5, target: 25, finalTarget: 15 } as never;
test('beach: 2–0, each set 21–0; indoor: 3–0, each 25–0', () => {
  const b = withWalkoverScore('volleyball', beach, { walkover: true }, 'A', { walkoverScore: 'straight' });
  expect([b.A.score, b.A.sets, b.B.sets, b.walkover_sets]).toEqual([2, [21, 21], [0, 0], true]);
  const i = withWalkoverScore('volleyball', indoor, { walkover: true }, 'B', { walkoverScore: 'straight' });
  expect([i.B.score, i.B.sets, i.A.sets]).toEqual([3, [25, 25, 25], [0, 0, 0]]);
});
test('the table counts them in the points', () => {
  const ss = withWalkoverScore('volleyball', beach, { walkover: true }, 'A', { walkoverScore: 'straight' });
  const st = computeStats(['X', 'Y'], [{ team_a_id: 'X', team_b_id: 'Y', winner_team_id: 'X', status: 'completed', score_summary: ss }] as never, undefined, pointsPresetFor('volleyball') as never).get('X')!;
  expect([st.scored, st.conceded, st.rallyFor, st.rallyAgainst]).toEqual([2, 0, 42, 0]);
});
test('other sports’ walkovers still play no rallies', () => {
  const ss = withWalkoverScore('badminton', { bestOf: 3 } as never, { walkover: true }, 'A', { walkoverScore: 'straight' });
  expect(ss.walkover_sets).toBeUndefined();
  const st = computeStats(['X', 'Y'], [{ team_a_id: 'X', team_b_id: 'Y', winner_team_id: 'X', status: 'completed', score_summary: ss }] as never).get('X')!;
  expect(st.rallyFor).toBe(0);
});
