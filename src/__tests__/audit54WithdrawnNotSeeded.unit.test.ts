/**
 * Audit #54 (11 Oct 2026): a group winner who withdrew after the groups was
 * still seeded into the knockout (a tie nobody could play). Now the next team
 * in that group goes through; the withdrawn team's games still count.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { maybeSeedKnockout } from '../controllers/tournaments.controller';

const T = 't54';
const g = (id: string, a: string, b: string, w: string, label: string) => ({ id, tournament_id: T, round: 0, group_label: label, team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', voided_at: null, score_summary: { A: { score: w === a ? 2 : 0 }, B: { score: w === b ? 2 : 0 } }, overs: null, bracket: null });
describe('audit #54: a withdrawn group winner is not seeded', () => {
  it('the next team in its group goes through instead', async () => {
    db = fakeDb({
      sports: [{ id: 's-fb', slug: 'football', allows_draw: true }],
      tournaments: [{ id: T, format: 'groups_knockout', sport_id: 's-fb', settings: {}, tiebreaker_rules: [], qualifiers_per_group: 1, num_groups: 2 }],
      tournament_entries: [
        { tournament_id: T, team_id: 'W', status: 'withdrawn', group_label: 'A', club: null, team: { name: 'Wolves' } },
        { tournament_id: T, team_id: 'X', status: 'approved', group_label: 'A', club: null, team: { name: 'Xenon' } },
        { tournament_id: T, team_id: 'Y', status: 'approved', group_label: 'B', club: null, team: { name: 'Yaks' } },
        { tournament_id: T, team_id: 'Z', status: 'approved', group_label: 'B', club: null, team: { name: 'Zebras' } },
        { tournament_id: T, team_id: 'P', status: 'pending', group_label: 'B', club: null, team: { name: 'Pending' } },
      ],
      matches: [
        g('g1', 'W', 'X', 'W', 'A'), g('g2', 'Y', 'Z', 'Y', 'B'),
        { id: 'k1', tournament_id: T, round: 1, match_no: 1, group_label: null, bracket: null, team_a_id: null, team_b_id: null, status: 'scheduled', voided_at: null, next_match_id: null },
      ],
      match_events: [],
    });
    await maybeSeedKnockout(T);
    const ko = db.t('matches').find((r) => r.id === 'k1')!;
    expect([ko.team_a_id, ko.team_b_id].sort()).toEqual(['X', 'Y']);
  });
});
