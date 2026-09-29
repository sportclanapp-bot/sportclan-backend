/**
 * BUILD 2.2 · the one rules validator (matchRules.rulesRefusal, shared with the
 * app) has the last word on create and edit, whichever way the rules came —
 * as data or as the older format / overs.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockRpcCalls: Array<[string, any]> = [];
let mockRpc: (name: string, args: any) => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
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
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async (n: string, a: any) => { mockRpcCalls.push([n, a]); return { data: null, error: null, ...mockRpc(n, a) }; }) } };
});
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => true),
}));
jest.mock('../utils/scoringLease', () => ({
  ...jest.requireActual('../utils/scoringLease'),
  checkLease: jest.fn(async () => ({ ok: true })),
  claimLease: jest.fn(async () => ({ taken: true, lease: null })),
  takeOverLease: jest.fn(async () => ({ ok: true, lease: null })),
}));
let mockPending = false;
jest.mock('../utils/singles', () => ({
  ...jest.requireActual('../utils/singles'),
  pendingRankedOpponent: jest.fn(async () => ({ pending: mockPending, opponentName: 'QA Device B' })),
}));
jest.mock('../utils/sportCache', () => ({
  ...jest.requireActual('../utils/sportCache'),
  getSport: jest.fn(async () => ({ slug: 'cricket' })),
}));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s === 'cricket' ? 'sport-cricket' : undefined)) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
// eslint-disable-next-line import/first
// eslint-disable-next-line import/first
import { createMatch, updateMatch } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { getSport } from '../utils/sportCache';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const TA = '33333333-3333-4333-8333-333333333333';
const TB = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: { id: MATCH }, query: {}, body: {}, headers: { 'x-device-id': 'dev-1' }, get: () => 'dev-1', header: () => 'dev-1', ...req }, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const matchRow = (extra: object = {}) => ({
  id: MATCH, created_by: ME, umpire_id: null, status: 'scheduled', team_a_id: TA, team_b_id: TB,
  sport_id: 'sport-cricket', is_open: false, format: 'T20', overs: 20, team_a_name: 'A', team_b_name: 'B', ...extra,
});
const onMatch = (m: object) => (q: Q) => (q[0] === 'from:matches' ? { data: m } : { data: null });

beforeEach(() => {
  mockLog = [];
  mockRpcCalls = [];
  mockRpc = () => ({ data: null, error: null });
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockPending = false;
});

const inserted = () => {
  const q = mockLog.find((x) => x[0] === 'from:matches' && x.some((c) => c.startsWith('insert:')));
  return q ? JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice('insert:'.length)) : null;
};
const created = { data: { id: MATCH } };
const onCreate = (q: Q) => (q[0] === 'from:matches' && q.some((c) => c.startsWith('insert:')) ? created : { data: null });
const body = (extra: object) => ({ sport_id: 'cricket', team_a_name: 'Lions', team_b_name: 'Tigers', scheduled_at: '2026-10-05T10:00:00Z', venue: 'Oval', ...extra });

const asSport = (slug: string) => (getSport as jest.Mock).mockResolvedValue({ slug });
afterEach(() => asSport('cricket'));

describe('BUILD 2.2 · create', () => {
  it('rules as data outside the limits → 400 BAD_RULES with the field', async () => {
    mockNext = onCreate;
    const r = await call(createMatch, { body: body({ rules: { v: 1, overs: 20, drawAllowed: false } }) });
    expect([r.statusCode, r.body.code, r.body.field]).toEqual([400, 'BAD_RULES', 'drawAllowed']);
    expect(inserted()).toBeNull();
  });
  it('the older format path is validated too: a chess clock that isn’t offered → 400 (it used to be stored as sent)', async () => {
    asSport('chess');
    mockNext = onCreate;
    const r = await call(createMatch, { body: body({ sport_id: 'cricket', format: 'Rapid 10+5' }) });
    expect([r.statusCode, r.body.code, r.body.field]).toEqual([400, 'BAD_RULES', 'baseMinutes']);
    const ok = await call(createMatch, { body: body({ sport_id: 'cricket', format: 'Rapid · 15+10' }) });
    expect(ok.statusCode).toBeLessThan(300);
    expect(inserted()).toMatchObject({ rules: { baseMinutes: 15, incrementSeconds: 10 } });
  });
  it('box without overs takes the box standard and passes', async () => {
    mockNext = onCreate;
    const r = await call(createMatch, { body: body({ format: 'pair' }) });
    expect(r.statusCode).toBeLessThan(300);
    expect(inserted()).toMatchObject({ format: 'pair', overs: 8, rules: { style: 'pair', overs: 8 } });
  });
});

describe('BUILD 2.2 · edit', () => {
  it('rules outside the limits → 400 BAD_RULES, nothing written', async () => {
    mockNext = onMatch(matchRow());
    const r = await call(updateMatch, { body: { rules: { v: 1, style: 'box', overs: 20 } } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'BAD_RULES']);
    expect(r.body.error).toBe('Overs must be 4, 6, 8 or 10 for box cricket.');
    expect(writes()).toHaveLength(0);
  });
  it('a field the sport doesn’t have → 400', async () => {
    mockNext = onMatch(matchRow());
    const r = await call(updateMatch, { body: { rules: { v: 1, overs: 20, bestOf: 3 } } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Match length doesn’t apply to this sport.']);
  });
});
