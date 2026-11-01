/**
 * N-R7-87 (Step 2 Batch 5, SP-TEN-F02): a qualifying draw stops after its rounds and crowns nobody, but its last
 * round took the event final’s rules (knockoutStage(r, maxRounds) called it the final): an Open with "pro set to 8
 * early, best of 3 final" played its final qualifying round best of 3. The stage now comes from the whole bracket.
 */
let mockSportSlug = 'cricket';
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
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSportSlug })) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { generateFixtures } from '../controllers/tournaments.controller';
const T = '22222222-2222-4222-8222-222222222222';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const call = async () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await generateFixtures({ userId: 'me', params: { id: T }, query: {}, body: {} } as any, r);
  return r;
};
const inserted = () => mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:')).flatMap((q) => q.filter((c) => c.startsWith('insert:')).map((c) => JSON.parse(c.slice(7)))).flat();
const PRO8 = { v: 1, bestOf: 1, gamesPerSet: 8 };
const BO3 = { v: 1, bestOf: 3, gamesPerSet: 6 };
const setup = (players: number, settings: object) => {
  mockLog = [];
  mockSportSlug = 'tennis';
  mockNext = (q) => {
    if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
    if (q[0] === 'from:tournaments' && has(q, 'eq:["parent_id"')) return { data: [] };
    if (q[0] === 'from:tournaments') return { data: { id: T, status: 'live', sport_id: 'sp', format: 'knockout', entry_kind: 'singles', start_date: '2026-11-01', match_rules: { default: PRO8, final: BO3 }, settings: { v: 1, ...settings }, parent_id: null } };
    if (q[0] === 'from:tournament_entries' && has(q, 'select:')) return { data: Array.from({ length: players }, (_, i) => ({ team_id: `t${i}`, team: { id: `t${i}`, name: `P${i}` } })) };
    if (q[0] === 'from:matches' && has(q, 'insert:')) return { data: [{ id: 'm1', match_no: 0 }] };
    return { data: [] };
  };
};

describe('N-R7-87 (SP-TEN-F02): a qualifying draw has no final — its last round plays the early rounds rules', () => {
  test('4 players, 1 qualifying round: both matches are the pro set to 8 (not the best of 3 of the final)', async () => {
    setup(4, { qualifying: { into: 'main', rounds: 1 } });
    expect((await call()).statusCode).toBe(200);
    const rows = inserted();
    expect(rows.length).toBe(2);
    for (const r of rows) expect([r.round, r.rules.bestOf, r.rules.gamesPerSet]).toEqual([1, 1, 8]);
  });
  test('8 players, 2 qualifying rounds: every match is the pro set', async () => {
    setup(8, { qualifying: { into: 'main', rounds: 2 } });
    expect((await call()).statusCode).toBe(200);
    const rows = inserted();
    expect(rows.length).toBe(6);
    for (const r of rows) expect([r.rules.bestOf, r.rules.gamesPerSet]).toEqual([1, 8]);
  });
  test('the main draw still plays its final best of 3', async () => {
    setup(4, {});
    expect((await call()).statusCode).toBe(200);
    const rows = inserted();
    const max = Math.max(...rows.map((r) => r.round));
    for (const r of rows) expect(r.rules.bestOf).toBe(r.round === max ? 3 : 1);
  });
});
