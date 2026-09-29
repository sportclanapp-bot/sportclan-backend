/**
 * BUILD 1.2 · a tournament's format can't change once fixtures are drawn.
 * PATCH /tournaments/:id accepted format after the draw; the bracket links,
 * legs and groups stayed while crowning/draws/walkovers switched format.
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
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const tour = (extra: object) => (q: Q) => (q[0] === 'from:tournaments' && q.some((c) => c.startsWith('select'))
  ? { data: { id: T, created_by: 'me', status: 'live', name: 'P3 Cup', format: 'knockout', fixtures_generated: true, ...extra } }
  : { data: null });
beforeEach(() => { mockLog = []; });

describe('format locked after the draw', () => {
  test('drawn knockout → league: 409 FORMAT_LOCKED, nothing written', async () => {
    mockNext = tour({});
    const r = await call({ format: 'league' });
    expect([r.statusCode, r.body.code]).toEqual([409, 'FORMAT_LOCKED']);
    expect(writes()).toHaveLength(0);
  });
  test('sending the same format is not a change', async () => {
    mockNext = tour({});
    const r = await call({ format: 'knockout', name: 'P3 Cup Renamed' });
    expect(r.statusCode).toBe(200);
  });
  test('before the draw the format can still change', async () => {
    mockNext = tour({ fixtures_generated: false, status: 'upcoming' });
    const r = await call({ format: 'league' });
    expect(r.statusCode).toBe(200);
    expect(writes()[0]!.join()).toContain('"format":"league"');
  });
});
