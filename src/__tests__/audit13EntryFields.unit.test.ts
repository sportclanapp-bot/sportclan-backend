/**
 * Audit #13 (11 Oct 2026): a team captain withdrawing their entry could also
 * write the organiser-only fields (fee paid, seed, group, club, fee note).
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async (_t: string, u: string) => u === 'org') }));
jest.mock('../utils/teamAuth', () => ({ ...jest.requireActual('../utils/teamAuth'), isTeamManager: jest.fn(async (_t: string, u: string) => u === 'capt') }));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(async () => undefined), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => false) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { updateEntry } from '../controllers/tournaments.controller';

const T = 'tttttttt-tttt-4ttt-8ttt-000000000001'; const E = 'eeeeeeee-eeee-4eee-8eee-000000000001';
const call = async (userId: string, body: object) => {
  const r: any = { statusCode: 200, body: null, on: () => r, once: () => r, locals: {} };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await updateEntry({ userId, params: { id: T, entryId: E }, body } as any, r);
  return r;
};

describe('audit #13: organiser-only entry fields', () => {
  beforeEach(() => {
    db = fakeDb({
      tournaments: [{ id: T, created_by: 'org', status: 'upcoming', fixtures_generated: false, sport_id: 's', max_teams: 8 }],
      tournament_entries: [{ id: E, tournament_id: T, team_id: 'team-1', status: 'approved', entry_tag: null, fee_paid_at: null, seed: null }],
      matches: [],
    });
  });
  it('a captain withdrawing can’t also mark the fee paid or set a seed', async () => {
    const r = await call('capt', { status: 'withdrawn', fee_paid: true, seed: 1 });
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('ORGANISER_ONLY_FIELDS');
    const e = db.t('tournament_entries')[0];
    expect(e.fee_paid_at).toBeNull();
    expect(e.status).toBe('approved');
  });
  it('a captain can still just withdraw', async () => {
    const r = await call('capt', { status: 'withdrawn' });
    expect(r.statusCode).toBe(200);
    expect(db.t('tournament_entries')[0].status).toBe('withdrawn');
  });
  it('the organiser can mark the fee paid', async () => {
    const r = await call('org', { fee_paid: true });
    expect(r.statusCode).toBe(200);
    expect(db.t('tournament_entries')[0].fee_paid_at).not.toBeNull();
  });
});
