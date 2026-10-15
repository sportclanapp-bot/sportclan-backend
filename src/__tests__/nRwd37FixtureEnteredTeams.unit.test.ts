/**
 * N-RWD3-7 (launch test plan, Round 3): an organiser could put ANY team in the app into one of their
 * fixtures through the API (and its members were then told 'Match rescheduled'). Only a team entered
 * (approved) in that tournament is taken.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true), canManageTournament: jest.fn(async () => true) }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUsers: jest.fn(async () => undefined), notifyUser: jest.fn(), matchAudienceIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { updateFixtures } from '../controllers/tournaments.controller';

const T = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333'; const B = '44444444-4444-4444-8444-444444444444'; const X = '55555555-5555-4555-8555-555555555555';
const call = async (team: string) => {
  const res: any = { statusCode: 200, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  await updateFixtures({ userId: 'org', params: { id: T }, body: { updates: [{ fixture_id: F, team_a_id: team }] } } as any, res);
  return res;
};
beforeEach(() => {
  db = fakeDb({
    tournaments: [{ id: T, created_by: 'org', format: 'knockout', status: 'upcoming', settings: {} }],
    tournament_organisers: [{ tournament_id: T, user_id: 'org', role: 'organiser' }],
    teams: [{ id: A, name: 'Lions' }, { id: B, name: 'Tigers' }, { id: X, name: 'Strangers' }],
    tournament_entries: [{ tournament_id: T, team_id: A, status: 'approved' }, { tournament_id: T, team_id: B, status: 'approved' }],
    matches: [{ id: F, tournament_id: T, status: 'scheduled', team_a_id: B, team_b_id: null, team_a_name: 'Tigers', voided_at: null }],
  });
});
test('a team that never entered is refused', async () => {
  const r = await call(X);
  expect(db.t('matches')[0].team_a_id).toBe(B);
  expect(JSON.stringify(r.body)).toContain('That team isn’t in this tournament.');
});
test('an entered team goes in', async () => {
  await call(A);
  expect([db.t('matches')[0].team_a_id, db.t('matches')[0].team_a_name]).toEqual([A, 'Lions']);
});
