/**
 * N-R7-376 (SIDE-C7-1): a badminton KO4 where P05 withdrew before the semi (lost it on a walkover, never played)
 * listed P05 as a semi-finalist (joint third) beside P07. A withdrawn walkover loser takes no bronze.
 */
import { knockoutPlacings } from '../controllers/awards.controller';

const m = (o: object) => ({ id: Math.random().toString(), team_a_id: null, team_b_id: null, team_a_name: null, team_b_name: null, winner_team_id: null, status: 'completed', round: 1, group_label: null, voided_at: null, score_summary: {}, ...o });
const semiWo = m({ team_a_id: 'P05', team_b_id: 'P08', team_a_name: 'P05', team_b_name: 'P08', winner_team_id: 'P08', status: 'abandoned', score_summary: { walkover: true } });
const semi2 = m({ team_a_id: 'P06', team_b_id: 'P07', team_a_name: 'P06', team_b_name: 'P07', winner_team_id: 'P06' });
const fin = m({ round: 2, team_a_id: 'P08', team_b_id: 'P06', team_a_name: 'P08', team_b_name: 'P06', winner_team_id: 'P08' });

test('the withdrawn walkover loser is left off; the other semi-finalist stays', () => {
  const p = knockoutPlacings([semiWo, semi2, fin] as never, new Set(['P05']));
  expect(p.map((x) => [x.place, x.name])).toEqual([[1, 'P08'], [2, 'P06'], [3, 'P07']]);
});
test('a walkover loser still entered (not withdrawn), or a withdrawn player who played the semi: still a semi-finalist', () => {
  expect(knockoutPlacings([semiWo, semi2, fin] as never).filter((x) => x.place === 3).map((x) => x.name)).toEqual(['P05', 'P07']);
  expect(knockoutPlacings([semiWo, semi2, fin] as never, new Set(['P07'])).filter((x) => x.place === 3).map((x) => x.name)).toEqual(['P05', 'P07']);
});
