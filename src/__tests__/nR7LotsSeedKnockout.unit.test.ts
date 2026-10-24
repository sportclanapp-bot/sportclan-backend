/**
 * SCR-T-S03 (Step 2 Batch 3, Job B): groups → knockout where a group's teams are
 * level on every tie-break. The knockout was seeded the moment the last group
 * match ended — from the team-id order the table shows "until lots are drawn" —
 * and recording the draw of lots afterwards changed the table but not the
 * knockout. Now seeding waits while a qualifying place is still level, and the
 * draw of lots seeds it.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true) }));
// eslint-disable-next-line import/first
import { maybeSeedKnockout } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { setLots } from '../controllers/lots.controller';

const T = '11111111-1111-4111-8111-111111111111';
const m = (id: string, a: string, b: string, sa: number, sb: number, label: string) => ({
  id, tournament_id: T, round: 0, group_label: label, team_a_id: a, team_b_id: b, winner_team_id: sa > sb ? a : sb > sa ? b : null,
  status: 'completed', voided_at: null, score_summary: { A: { score: sa }, B: { score: sb } }, overs: null, bracket: null,
});
const ko = (id: string, no: number) => ({ id, tournament_id: T, round: 1, match_no: no, group_label: null, bracket: null, team_a_id: null, team_b_id: null, status: 'scheduled', voided_at: null, next_match_id: null });
const seed = (settings: Record<string, unknown> = {}) => fakeDb({
  sports: [{ id: 's-fb', slug: 'football', allows_draw: true }],
  tournaments: [{ id: T, format: 'groups_knockout', sport_id: 's-fb', settings, tiebreaker_rules: [], qualifiers_per_group: 2, num_groups: 2 }],
  tournament_entries: ['A', 'B', 'C', 'D', 'E', 'F'].map((x, i) => ({ tournament_id: T, team_id: x, status: 'approved', group_label: i < 3 ? 'A' : 'B', club: null, team: { name: 'Team ' + x } })),
  matches: [
    m('a1', 'A', 'B', 1, 1, 'A'), m('a2', 'A', 'C', 1, 1, 'A'), m('a3', 'B', 'C', 1, 1, 'A'), // group A: all level
    m('b1', 'D', 'E', 1, 0, 'B'), m('b2', 'D', 'F', 1, 0, 'B'), m('b3', 'E', 'F', 1, 0, 'B'), // group B: D, E, F
    ko('k1', 1), ko('k2', 2),
  ],
  match_events: [],
});
const pairs = () => db.t('matches').filter((r) => r.round === 1).map((r) => [r.team_a_id, r.team_b_id].sort().join('-')).sort();

describe('SCR-T-S03: the knockout waits for a draw of lots', () => {
  it('does not seed while group A is level on every tie-break', async () => {
    db = seed();
    await maybeSeedKnockout(T);
    expect(db.t('matches').filter((r) => r.round === 1).every((r) => !r.team_a_id && !r.team_b_id)).toBe(true);
  });
  it('seeds from the lots order (C winner, A runner-up)', async () => {
    db = seed({ v: 1, lots: { A: ['C', 'A', 'B'] } });
    await maybeSeedKnockout(T);
    expect(pairs()).toEqual(['A-D', 'C-E']);
  });
  it('recording the draw of lots seeds the knockout', async () => {
    db = seed();
    const res: any = { statusCode: 200, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await setLots({ userId: 'org', params: { id: T }, body: { group: 'A', order: ['C', 'A', 'B'] } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(pairs()).toEqual(['A-D', 'C-E']);
  });
});
