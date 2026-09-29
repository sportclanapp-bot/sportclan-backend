/**
 * BUILD 3.2 · players a side (2–15; null = the line-up decides) is part of a
 * cricket match's rules and sets when a side is all out: one wicket short of
 * it (15 a side → 14, past the old cap of 10). Fields only rules carry are kept
 * whole on create and on a later format / overs edit.
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
import { allOutBySide } from '../utils/cricketRules';
// eslint-disable-next-line import/first
import { rulesRefusal, standardRules } from '../utils/matchRules';

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

const lineup = (a: number, b: number) => [...Array(a).fill({ team_side: 'A' }), ...Array(b).fill({ team_side: 'B' })];

describe('BUILD 3.2 · all out from players a side', () => {
  test('set: one short of it, whatever the line-up', () => {
    expect(allOutBySide(lineup(3, 3), 6)).toEqual({ A: 5, B: 5 });
    expect(allOutBySide(lineup(11, 11), 15)).toEqual({ A: 14, B: 14 });
  });
  test('not set: the line-up, as before', () => {
    expect(allOutBySide(lineup(6, 11))).toEqual({ A: 5, B: 10 });
    expect(allOutBySide(lineup(6, 11), null)).toEqual({ A: 5, B: 10 });
  });
  test('the validator: whole 2–15 or null', () => {
    const r = (players: unknown) => rulesRefusal('cricket', { ...standardRules('cricket'), players });
    expect(r(6)).toBeNull();
    expect(r(null)).toBeNull();
    for (const bad of [1, 16, 6.5, '6']) expect(r(bad)?.error).toBe('Players a side must be a whole number from 2 to 15.');
  });
});

describe('BUILD 3.2 · stored whole', () => {
  it('create with rules keeps players a side', async () => {
    mockNext = onCreate;
    const r = await call(createMatch, { body: body({ rules: { v: 1, style: 'box', overs: 6, players: 6 } }) });
    expect(r.statusCode).toBeLessThan(300);
    expect(inserted()).toMatchObject({ format: 'box', overs: 6, rules: { style: 'box', overs: 6, players: 6 } });
  });
  it('a later format / overs edit keeps it', async () => {
    mockNext = onMatch(matchRow({ format: 'box', overs: 6, rules: { v: 1, style: 'box', overs: 6, players: 6, drawAllowed: true } }));
    const r = await call(updateMatch, { body: { format: 'box', overs: 8 } });
    expect(r.statusCode).toBe(200);
    expect(writes()[0]!.join()).toContain('"rules":{"v":1,"style":"box","overs":8,"players":6,"lastManStands":false,"retireAt":null,"bowlerOvers":null,"extraRuns":1,"rebowl":true,"freeHit":false,"inningsMinutes":null,"powerplayOvers":null,"drawAllowed":true}');
  });
});
