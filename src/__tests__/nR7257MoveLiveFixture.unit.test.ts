/** N-R7-257 (Step 2 B10, SPP2-VOL-062): a LIVE fixture can be moved to another court / time (lights fail mid-set);
 *  its score, status and teams stay. Teams / result changes on a live fixture are still refused. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true), canManageTournament: jest.fn(async () => true) }));
// eslint-disable-next-line import/first
import { updateFixtures } from '../controllers/tournaments.controller';

const T = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333';
const B = '44444444-4444-4444-8444-444444444444';
const C = '55555555-5555-4555-8555-555555555555';
const seed = (status: string) => {
  db = fakeDb({
    tournaments: [{ id: T, created_by: 'org', format: 'league', status: 'ongoing', settings: {} }],
    tournament_organisers: [{ tournament_id: T, user_id: 'org', role: 'organiser' }],
    teams: [{ id: C, name: 'Club 3' }],
    tournament_entries: [{ tournament_id: T, team_id: C, status: 'approved' }],
    matches: [{ id: F, tournament_id: T, status, scheduled_at: '2026-11-10T12:30:00Z', ground_label: 'Court 1', team_a_id: A, team_b_id: B, team_a_score: 1, team_b_score: 0, winner_team_id: null, voided_at: null }],
  });
};
const call = async (u: Record<string, unknown>) => {
  const res: any = { statusCode: 200, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  await updateFixtures({ userId: 'org', params: { id: T }, body: { updates: [{ fixture_id: F, ...u }] } } as any, res);
  return res;
};

test('a live fixture moves to Court 2, next day, keeping its live score', async () => {
  seed('live');
  const res = await call({ scheduled_at: '2026-11-11T13:00:00Z', ground_label: 'Court 2' });
  const m = db.t('matches')[0];
  expect([m.ground_label, m.scheduled_at, m.status, m.team_a_score]).toEqual(['Court 2', '2026-11-11T13:00:00Z', 'live', 1]);
  expect(res.body.skipped ?? []).toEqual([]);
});

test('a live fixture still can’t change its teams or lose its time', async () => {
  seed('live');
  const r1 = await call({ team_a_id: C });
  expect(db.t('matches')[0].team_a_id).toBe(A);
  expect(r1.body.error).toMatch(/hasn’t started/);
  await call({ scheduled_at: null });
  expect(db.t('matches')[0].scheduled_at).toBe('2026-11-10T12:30:00Z');
});

test('a completed fixture can’t be moved', async () => {
  seed('completed');
  await call({ ground_label: 'Court 2' });
  expect(db.t('matches')[0].ground_label).toBe('Court 1');
});
