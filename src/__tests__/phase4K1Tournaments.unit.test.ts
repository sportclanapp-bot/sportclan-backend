/**
 * Phase 4 · K1-13 — a tournament keeps the city NAME the create screen sends
 * (migration 025 added tournaments.city). Harness copied from
 * phase3TournamentsB08.unit.test.ts: each query resolves to `mockNext(q)`.
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
import { createTournament, updateTournament } from '../controllers/tournaments.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: { id: T }, query: {}, body: {}, ...req }, r);
  return r;
};
const written = (verb: 'insert' | 'update') => mockLog
  .filter((q) => q[0] === 'from:tournaments')
  .flatMap((q) => q.filter((c) => c.startsWith(`${verb}:`)).map((c) => JSON.parse(c.slice(verb.length + 1))))
  // insert records the row; update records its argument list
  .map((x) => (verb === 'update' ? x[0] : x));

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('K1-13 (7b64be8) · tournament city as text', () => {
  test('K1-13 (7b64be8): create stores the typed city name', async () => {
    mockNext = (q) => (q[0] === 'from:tournaments' && q.some((c) => c.startsWith('insert:')) ? { data: { id: T } } : { data: null });
    const r = await call(createTournament, { body: { name: 'Pune Premier Cup', sport_id: 'sport-cricket', format: 'knockout', max_teams: 4, city: 'Pune' } });
    expect(r.statusCode).toBeLessThan(300);
    expect(written('insert')[0]).toMatchObject({ city: 'Pune' });
  });
  test('K1-13 (7b64be8): edit accepts city (it is on the allowed-keys list)', async () => {
    mockNext = (q) => (q[0] === 'from:tournaments'
      ? { data: { id: T, created_by: ME, status: 'upcoming', name: 'Pune Premier Cup', start_date: null, end_date: null } }
      : { data: null, count: 0 });
    const r = await call(updateTournament, { body: { city: 'Mumbai' } });
    expect(r.statusCode).toBeLessThan(300);
    expect(written('update').some((u) => u.city === 'Mumbai')).toBe(true);
  });
});
