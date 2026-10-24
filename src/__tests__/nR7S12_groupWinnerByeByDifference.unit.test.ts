/**
 * N-R7-S12 (Step 2, Batch 5, SPP1-TEN-117): with fewer group qualifiers than knockout places,
 * the byes go to the best qualifiers — but within a tier (all the group winners) they were
 * ordered by points, then team id, so a winner with a worse set difference got the bye.
 * A tier is now ordered as the best-placed teams across groups are: points, difference,
 * scored (per game played), then the tie-breaks that can compare teams from different groups.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { maybeSeedKnockout } from '../controllers/tournaments.controller';

const T = 'tS12';
const g = (id: string, a: string, b: string, sa: number, sb: number, label: string) => ({ id, tournament_id: T, round: 0, group_label: label, team_a_id: a, team_b_id: b, winner_team_id: sa > sb ? a : b, status: 'completed', voided_at: null, score_summary: { A: { score: sa }, B: { score: sb } }, overs: null, bracket: null });
const ko = (id: string, n: number, next: string | null) => ({ id, tournament_id: T, round: 1, match_no: n, group_label: null, bracket: null, team_a_id: null, team_b_id: null, status: 'scheduled', voided_at: null, next_match_id: next });
test('3 groups, 1 qualifier each: the bye goes to the winner with the best set difference, not the lowest team id', async () => {
  db = fakeDb({
    sports: [{ id: 's-tn', slug: 'tennis', allows_draw: false }],
    tournaments: [{ id: T, format: 'groups_knockout', sport_id: 's-tn', settings: {}, tiebreaker_rules: ['head_to_head', 'score_diff', 'score_scored'], qualifiers_per_group: 1, num_groups: 3 }],
    tournament_entries: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map((id) => ({ tournament_id: T, team_id: id, status: 'approved', group_label: id[0]!.toUpperCase(), club: null, team: { name: id.toUpperCase() } })),
    matches: [g('ga', 'a1', 'a2', 2, 1, 'A'), g('gb', 'b1', 'b2', 2, 1, 'B'), g('gc', 'c1', 'c2', 2, 0, 'C'), ko('k1', 0, 'f'), ko('k2', 1, 'f'), { ...ko('f', 0, null), round: 2 }],
    match_events: [],
  });
  await maybeSeedKnockout(T);
  const r1 = db.t('matches').filter((r) => r.round === 1).map((r) => [r.team_a_id, r.team_b_id]);
  const bye = r1.find(([a, b]) => !a || !b)!;
  expect(bye.filter(Boolean)).toEqual(['c1']);
});
