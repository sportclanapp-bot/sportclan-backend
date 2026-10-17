/**
 * E-092 (Round 6): PATCH /matches/:id { status: 'cancelled' } cancelled a match
 * around cancel's own rules — a casual match's umpire could cancel it (only the
 * creator may), a knockout fixture was cancelled past KNOCKOUT_NO_CANCEL, and
 * nobody was told. An edit that cancels is now a cancel.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true) }));
const notifyUsers = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: (...a: unknown[]) => notifyUsers(...a), matchAudienceIds: jest.fn(async () => ['p1']) }));
// eslint-disable-next-line import/first
import { updateMatch } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const M = '11111111-1111-4111-8111-111111111111';

beforeEach(() => notifyUsers.mockClear());

test('a casual match’s umpire can’t cancel it by editing it', async () => {
  db = fakeDb({ matches: [{ id: M, created_by: 'creator', umpire_id: 'ump', status: 'scheduled', tournament_id: null, team_a_id: 'A', team_b_id: 'B' }] });
  const r = res();
  await updateMatch({ userId: 'ump', params: { id: M }, body: { status: 'cancelled' } } as any, r);
  expect(r.statusCode).toBe(403);
  expect(db.t('matches')[0]!.status).toBe('scheduled');
});

test('a knockout fixture can’t be cancelled by editing it', async () => {
  db = fakeDb({ tournaments: [{ id: 'T', format: 'knockout', status: 'live' }], matches: [{ id: M, created_by: 'org', status: 'scheduled', tournament_id: 'T', round: 1, group_label: null, team_a_id: 'A', team_b_id: 'B' }] });
  const r = res();
  await updateMatch({ userId: 'org', params: { id: M }, body: { status: 'cancelled' } } as any, r);
  expect([r.statusCode, r.body.code]).toEqual([409, 'KNOCKOUT_NO_CANCEL']);
  expect(db.t('matches')[0]!.status).toBe('scheduled');
});

test('the creator’s cancel by edit still works, and the players are told', async () => {
  db = fakeDb({ matches: [{ id: M, created_by: 'creator', umpire_id: 'ump', status: 'scheduled', tournament_id: null, team_a_id: 'A', team_b_id: 'B', team_a_name: 'A', team_b_name: 'B' }] });
  const r = res();
  await updateMatch({ userId: 'creator', params: { id: M }, body: { status: 'cancelled' } } as any, r);
  expect(r.statusCode).toBe(200);
  expect(db.t('matches')[0]!.status).toBe('cancelled');
  expect(notifyUsers).toHaveBeenCalledWith(['p1'], expect.objectContaining({ type: 'match_cancelled' }));
});

test('a cancel mixed with other changes is refused, nothing changes', async () => {
  db = fakeDb({ matches: [{ id: M, created_by: 'creator', status: 'scheduled', tournament_id: null, venue: 'Old' }] });
  const r = res();
  await updateMatch({ userId: 'creator', params: { id: M }, body: { status: 'cancelled', venue: 'New' } } as any, r);
  expect([r.statusCode, r.body.code]).toEqual([400, 'CANCEL_ALONE']);
  expect([db.t('matches')[0]!.status, db.t('matches')[0]!.venue]).toEqual(['scheduled', 'Old']);
});
