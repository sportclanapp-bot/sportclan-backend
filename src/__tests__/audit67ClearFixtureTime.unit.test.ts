/** Audit #67 (11 Oct 2026): clearing a fixture's time (scheduled_at: null) unschedules it; it used to be ignored. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true), canManageTournament: jest.fn(async () => true) }));
// eslint-disable-next-line import/first
import { updateFixtures } from '../controllers/tournaments.controller';

const T = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
test('scheduled_at: null clears the time of a fixture not yet started', async () => {
  db = fakeDb({
    tournaments: [{ id: T, created_by: 'org', format: 'league', status: 'upcoming', settings: {} }],
    tournament_organisers: [{ tournament_id: T, user_id: 'org', role: 'organiser' }],
    matches: [{ id: F, tournament_id: T, status: 'scheduled', scheduled_at: '2026-10-15T12:30:00Z', team_a_id: 'A', team_b_id: 'B', voided_at: null }],
  });
  const res: any = { statusCode: 200, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  await updateFixtures({ userId: 'org', params: { id: T }, body: { updates: [{ fixture_id: F, scheduled_at: null }] } } as any, res);
  expect(db.t('matches')[0].scheduled_at).toBeNull();
});
