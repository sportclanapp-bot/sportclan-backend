/**
 * N-R7-S54 (Step 2 Batch 14, SCR-T-146) · the fixture editor's API put the same team on both
 * sides of a fixture (Team 01 v Team 01) and saved it — the table then counted a team playing
 * itself. A side that would equal the other side is refused: 'Team A and Team B must be different.'
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
const A = '33333333-3333-4333-8333-333333333333'; const B = '44444444-4444-4444-8444-444444444444';
const call = async (upd: Record<string, unknown>) => {
  const res: any = { statusCode: 200, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  await updateFixtures({ userId: 'org', params: { id: T }, body: { updates: [{ fixture_id: F, ...upd }] } } as any, res);
  return res;
};
beforeEach(() => {
  db = fakeDb({
    tournaments: [{ id: T, created_by: 'org', format: 'league', status: 'upcoming', settings: {} }],
    tournament_organisers: [{ tournament_id: T, user_id: 'org', role: 'organiser' }],
    teams: [{ id: A, name: 'Lions' }, { id: B, name: 'Tigers' }],
    tournament_entries: [{ tournament_id: T, team_id: A, status: 'approved' }, { tournament_id: T, team_id: B, status: 'approved' }],
    matches: [{ id: F, tournament_id: T, status: 'scheduled', team_a_id: A, team_b_id: B, team_a_name: 'Lions', team_b_name: 'Tigers', voided_at: null }],
  });
});
test('both sides set to one team: refused, fixture unchanged', async () => {
  const r = await call({ team_a_id: A, team_b_id: A });
  expect(r.statusCode).toBe(400);
  expect(r.body).toEqual({ error: 'Team A and Team B must be different.', code: 'FIXTURE_NOT_SAVED' });
  expect([db.t('matches')[0].team_a_id, db.t('matches')[0].team_b_id]).toEqual([A, B]);
});
test('one side moved onto the team already on the other side: refused', async () => {
  const r = await call({ team_b_id: A });
  expect(r.statusCode).toBe(400);
  expect(db.t('matches')[0].team_b_id).toBe(B);
});
test('swapping the two teams is fine', async () => {
  const r = await call({ team_a_id: B, team_b_id: A });
  expect(r.statusCode).toBe(200);
  expect([db.t('matches')[0].team_a_id, db.t('matches')[0].team_b_id]).toEqual([B, A]);
});
test('emptying a slot is fine', async () => {
  const r = await call({ team_b_id: null });
  expect(r.statusCode).toBe(200);
  expect(db.t('matches')[0].team_b_id).toBeNull();
});
