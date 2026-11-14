/**
 * N-R7-S162 (Step 2 B15, SIDE-X2-1 / RW-G6-083): two organisers edit the same tournament; the later
 * save silently replaced the earlier one. With expected_updated_at (when the app opened the form) a
 * save over a newer row is refused with 409 TOURNAMENT_CHANGED and the write is guarded on the row read.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  isTournamentOrganiser: jest.fn(async () => true),
  logAdminAction: jest.fn(),
}));
jest.mock('../utils/teamVisibility', () => ({ ...jest.requireActual('../utils/teamVisibility'), isTeamDisbanded: jest.fn(async () => false) }));
let mockCanOpenChat = false;
jest.mock('../utils/tournamentChat', () => ({
  syncTournamentChatMembers: jest.fn(async () => undefined),
  syncAfterSuccess: jest.fn(),
  canOpenTournamentChat: jest.fn(async () => mockCanOpenChat),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => undefined) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { updateTournament } from '../controllers/tournaments.controller';

const T = '22222222-2222-4222-8222-222222222222';
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await updateTournament({ userId: 'me', params: { id: T }, query: {}, body } as any, r);
  return r;
};
const tour = (extra: object) => (q: Q) => (q[0] === 'from:tournaments' && q.some((c) => c.startsWith('select'))
  ? { data: { id: T, created_by: 'me', status: 'live', name: 'P3 Cup', format: 'knockout', fixtures_generated: true, ...extra } }
  : { data: null });
beforeEach(() => { mockLog = []; });
const patched = () => {
  const q = mockLog.find((x) => x[0] === 'from:tournaments' && x.some((c) => c.startsWith('update:')));
  return q ? JSON.parse(q.find((c) => c.startsWith('update:'))!.slice(7))[0] : null;
};

const STORED = '2026-11-15T03:00:00.123456+00:00';
describe('N-R7-S162 · a save over another organiser\'s newer save', () => {
  test('the form was opened before the other save: 409 TOURNAMENT_CHANGED, nothing written', async () => {
    mockNext = tour({ status: 'upcoming', fixtures_generated: false, updated_at: STORED });
    const r = await call({ name: 'Pune Monsoon League', expected_updated_at: '2026-11-15T02:50:00.000000+00:00' });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('TOURNAMENT_CHANGED');
    expect(patched()).toBeNull();
  });
  test('the form saw the latest row: saved, and the write is guarded on that row', async () => {
    mockNext = tour({ status: 'upcoming', fixtures_generated: false, updated_at: STORED });
    const r = await call({ name: 'Pune Monsoon League', expected_updated_at: STORED });
    expect(r.statusCode).toBe(200);
    expect(patched()).toHaveProperty('name', 'Pune Monsoon League');
    const q = mockLog.find((x) => x[0] === 'from:tournaments' && x.some((c) => c.startsWith('update:')))!;
    expect(q).toContain(`eq:${JSON.stringify(['updated_at', STORED])}`);
  });
  test('an older app (no expected_updated_at): last save still wins, no guard', async () => {
    mockNext = tour({ status: 'upcoming', fixtures_generated: false, updated_at: STORED });
    const r = await call({ name: 'Pune Monsoon League' });
    expect(r.statusCode).toBe(200);
    const q = mockLog.find((x) => x[0] === 'from:tournaments' && x.some((c) => c.startsWith('update:')))!;
    expect(q.some((c) => c.startsWith('eq:["updated_at"'))).toBe(false);
  });
});
