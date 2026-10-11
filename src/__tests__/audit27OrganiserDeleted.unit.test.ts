/** Audit #27 (11 Oct 2026): a tournament could be handed to (or shared with) a deleted account. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true), userIsAdmin: jest.fn(async () => false) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn() }));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn() }));
// eslint-disable-next-line import/first
import { addTournamentOrganiser, reassignTournamentOrganiser } from '../controllers/tournaments.controller';

const T = 'tttttttt-tttt-4ttt-8ttt-000000000027'; const GONE = 'dddddddd-dddd-4ddd-8ddd-000000000027';
const call = async (fn: any, body: object) => {
  const r: any = { statusCode: 200, body: null, on: () => r };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'owner', params: { id: T }, body } as any, r);
  return r;
};
describe('audit #27: no organiser role for a deleted account', () => {
  beforeEach(() => {
    db = fakeDb({ tournaments: [{ id: T, created_by: 'owner', parent_id: null, status: 'upcoming' }], users: [{ id: GONE, name: 'Deleted User', deleted_at: '2026-10-01T00:00:00Z' }], tournament_organisers: [] });
  });
  it('add as co-organiser → 404', async () => {
    expect((await call(addTournamentOrganiser, { user_id: GONE })).statusCode).toBe(404);
    expect(db.t('tournament_organisers')).toHaveLength(0);
  });
  it('hand the tournament over → 404', async () => {
    const r = await call(reassignTournamentOrganiser, { user_id: GONE });
    expect([400, 404]).toContain(r.statusCode);
    expect(db.t('tournaments')[0].created_by).toBe('owner');
  });
});
