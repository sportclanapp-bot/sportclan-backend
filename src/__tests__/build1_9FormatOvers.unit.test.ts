/**
 * BUILD 1.9 · a cricket `T<n>` sent without `overs`.
 *
 * It was accepted and stored as `T7` with no overs, and an innings with no
 * overs lasts 20 — the match said seven and played twenty. The overs are now
 * filled from the format and checked like any other overs: `T20` stores 20,
 * `T7` (not offered then) was refused — BUILD 3.1 made any 1–50 valid. On create and on edit. Supabase is mocked
 * like phase4K2Matches.
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
import { createMatch, updateMatch, oversFromFormat } from '../controllers/matches.controller';

// A start a week ahead: a fixed date (it was 5 Oct 2026) turns into a refused
// past start the day it passes, and every create test then fails with 400.
const FUTURE = new Date(Date.now() + 7 * 864e5).toISOString();

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
const body = (extra: object) => ({ sport_id: 'cricket', team_a_name: 'Lions', team_b_name: 'Tigers', scheduled_at: FUTURE, venue: 'Oval', ...extra });

describe('BUILD 1.9 · oversFromFormat', () => {
  it.each([['T20', 20], ['t10', 10], [' T7 ', 7], ['box', null], ['pair', null], ['T', null], [20, null], [null, null]])('%p → %p', (f, n) => {
    expect(oversFromFormat(f)).toBe(n);
  });
});

describe('BUILD 1.9 · create', () => {
  it('T20 with no overs stores overs 20', async () => {
    mockNext = onCreate;
    const r = await call(createMatch, { body: body({ format: 'T20' }) });
    expect(r.statusCode).toBeLessThan(300);
    expect(inserted()).toMatchObject({ format: 'T20', overs: 20 });
  });
  it('T7 with no overs → 7 overs; T51 → 51 overs (Stage 13 · CR3: no top); T0 → 400 BAD_OVERS', async () => {
    mockNext = onCreate;
    const ok = await call(createMatch, { body: body({ format: 'T7' }) });
    expect(ok.statusCode).toBeLessThan(300);
    expect(inserted()).toMatchObject({ format: 'T7', overs: 7 });
    mockLog = [];
    const big = await call(createMatch, { body: body({ format: 'T51' }) });
    expect(big.statusCode).toBeLessThan(300);
    expect(inserted()).toMatchObject({ format: 'T51', overs: 51 });
    mockLog = [];
    const r = await call(createMatch, { body: body({ format: 'T0' }) });
    expect([r.statusCode, r.body.code]).toEqual([400, 'BAD_OVERS']);
    expect(inserted()).toBeNull();
  });
  it('box with no overs takes the box standard, 6 (BUILD 2.2 — it stored none and played 20)', async () => {
    mockNext = onCreate;
    const r = await call(createMatch, { body: body({ format: 'box' }) });
    expect(r.statusCode).toBeLessThan(300);
    expect(inserted()).toMatchObject({ format: 'box', overs: 6 });
  });
  it('T10 with overs 10 is unchanged', async () => {
    mockNext = onCreate;
    await call(createMatch, { body: body({ format: 'T10', overs: 10 }) });
    expect(inserted()).toMatchObject({ format: 'T10', overs: 10 });
  });
});

describe('BUILD 1.9 · edit', () => {
  it('T10 on a match with no overs stores overs 10 too', async () => {
    mockNext = onMatch(matchRow({ format: null, overs: null }));
    const r = await call(updateMatch, { body: { format: 'T10' } });
    expect(r.statusCode).toBe(200);
    expect(writes()[0]!.join()).toContain('"overs":10');
  });
  it('T0 on a match with no overs → 400 BAD_OVERS, nothing written (BUILD 3.1: T7 is fine now; Stage 13 · CR3: so is T51)', async () => {
    mockNext = onMatch(matchRow({ format: null, overs: null }));
    const r = await call(updateMatch, { body: { format: 'T0' } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'BAD_OVERS']);
    expect(writes()).toHaveLength(0);
    mockNext = onMatch(matchRow({ format: null, overs: null }));
    const ok = await call(updateMatch, { body: { format: 'T51' } });
    expect(ok.statusCode).toBe(200);
    expect(writes()[0]!.join()).toContain('"overs":51');
  });
  it('T10 on a 20-over match is still a mismatch', async () => {
    mockNext = onMatch(matchRow());
    const r = await call(updateMatch, { body: { format: 'T10' } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'FORMAT_OVERS_MISMATCH']);
  });
});
