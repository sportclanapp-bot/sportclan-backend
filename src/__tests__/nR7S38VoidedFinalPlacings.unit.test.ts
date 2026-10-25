/**
 * N-R7-S38 (Step 2 Batch 13, INV-271 / SCR-T-067 / SCR-T-068) · a voided knockout final
 * leaves no placings. Before: the voided final was dropped first, so a semi-final became
 * the "final" and its winner was named Winner (and teams could appear twice).
 */
import { knockoutPlacings } from '../controllers/awards.controller';

const m = (o: Record<string, unknown>): Record<string, unknown> => ({ voided_at: null, group_label: null, third_place: false, status: 'completed', ...o });
const KO = [
  m({ id: 'sf1', round: 1, team_a_id: 'a', team_b_id: 'd', team_a_name: 'A', team_b_name: 'D', winner_team_id: 'a' }),
  m({ id: 'sf2', round: 1, team_a_id: 'b', team_b_id: 'c', team_a_name: 'B', team_b_name: 'C', winner_team_id: 'b' }),
  m({ id: 'f', round: 2, team_a_id: 'a', team_b_id: 'b', team_a_name: 'A', team_b_name: 'B', winner_team_id: 'a' }),
  m({ id: 't', round: 2, third_place: true, team_a_id: 'd', team_b_id: 'c', team_a_name: 'D', team_b_name: 'C', winner_team_id: 'c' }),
];

test('the final voided: no winner, no runner-up, no semi-final named as the final', () => {
  const voided = KO.map((x) => (x.id === 'f' ? { ...x, voided_at: '2026-10-25T06:00:00Z' } : x));
  expect(knockoutPlacings(voided as never)).toEqual([]);
});
test('the final restored: placings as before', () => {
  expect(knockoutPlacings(KO as never).map((p) => `${p.place} ${p.title} ${p.name}`)).toEqual(['1 Winner A', '2 Runner-up B', '3 Third C', '4 Fourth D']);
});
