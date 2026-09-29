/**
 * BUILD 2.1 · matches carry their rules as data (matches.rules, migration
 * 114). New matches and fixtures store them; `format` / `overs` stay in step
 * for older apps; a match stored before reads back as it plays. Until the
 * validator (2.2) a rules object must say what format / overs can.
 * Supabase is mocked like phase4K2Matches.
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
import { createMatch, updateMatch, getMatch, rulesAsLegacy } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { SPORT_RULES, rulesFromLegacy } from '../utils/matchRules';
// eslint-disable-next-line import/first
import { SET_CONFIG } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { MATCH_LENGTHS } from '../utils/matchLength';

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

describe('BUILD 2.1 · create', () => {
  it('format / overs only (an older app) → the rules are stored too', async () => {
    mockNext = onCreate;
    const r = await call(createMatch, { body: body({ format: 'T10', overs: 10 }) });
    expect(r.statusCode).toBeLessThan(300);
    expect(inserted()).toMatchObject({ format: 'T10', overs: 10, rules: { v: 1, style: 'limited', overs: 10, players: null, lastManStands: false, retireAt: null, bowlerOvers: null, extraRuns: 1, rebowl: true, freeHit: false, drawAllowed: true } });
  });
  it('rules only → format / overs are written from them', async () => {
    mockNext = onCreate;
    const r = await call(createMatch, { body: body({ rules: { v: 1, style: 'box', overs: 6 } }) });
    expect(r.statusCode).toBeLessThan(300);
    expect(inserted()).toMatchObject({ format: 'box', overs: 6, rules: { style: 'box', overs: 6 } });
  });
  it('rules outside what’s offered → 400 BAD_RULES naming the field (2.2 validator), nothing inserted', async () => {
    mockNext = onCreate;
    const r = await call(createMatch, { body: body({ rules: { v: 1, overs: 51 } }) });
    expect([r.statusCode, r.body.code, r.body.field]).toEqual([400, 'BAD_RULES', 'overs']);
    const r2 = await call(createMatch, { body: body({ rules: 'T20' }) });
    expect([r2.statusCode, r2.body.code]).toEqual([400, 'BAD_RULES']);
    expect(inserted()).toBeNull();
  });
  it('rulesAsLegacy: accepted rules → format / overs; others → the refusal', () => {
    expect(rulesAsLegacy('cricket', { v: 1, overs: 20, drawAllowed: false })).toMatchObject({ refusal: { field: 'drawAllowed' } });
    expect(rulesAsLegacy('cricket', { v: 1, overs: 20 })).toEqual({ format: 'T20', overs: 20 });
    expect(rulesAsLegacy('badminton', { v: 1, bestOf: 1 })).toEqual({ format: 'bo1', overs: null });
    expect(rulesAsLegacy('badminton', { v: 1, bestOf: 3, target: 15 })).toMatchObject({ refusal: { field: 'target' } });
  });
});

describe('BUILD 2.1 · edit keeps format / overs and rules in step', () => {
  it('rules sent → format / overs written, rules stored', async () => {
    mockNext = onMatch(matchRow());
    const r = await call(updateMatch, { body: { rules: { v: 1, style: 'limited', overs: 10 } } });
    expect(r.statusCode).toBe(200);
    const w = writes()[0]!.join();
    expect(w).toContain('"format":"T10"');
    expect(w).toContain('"overs":10');
    expect(w).toContain('"rules":{"v":1,"style":"limited","overs":10,"players":null,"lastManStands":false,"retireAt":null,"bowlerOvers":null,"extraRuns":1,"rebowl":true,"freeHit":false,"drawAllowed":true}');
  });
  it('format / overs sent → rules follow', async () => {
    mockNext = onMatch(matchRow());
    await call(updateMatch, { body: { format: 'T50', overs: 50 } });
    expect(writes()[0]!.join()).toContain('"rules":{"v":1,"style":"limited","overs":50,"players":null,"lastManStands":false,"retireAt":null,"bowlerOvers":null,"extraRuns":1,"rebowl":true,"freeHit":false,"drawAllowed":true}');
  });
  it('rules on a started match → 409 RULES_LOCKED', async () => {
    mockNext = onMatch(matchRow({ status: 'live' }));
    const r = await call(updateMatch, { body: { rules: { v: 1, overs: 10 } } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'RULES_LOCKED']);
  });
});

describe('BUILD 2.1 · reading', () => {
  it('getMatch fills the rules in for a match stored before them', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: matchRow({ rules: null, format: 'T7', overs: 7 }) } : { data: null, count: 0 });
    const r = await call(getMatch, {});
    expect(r.body.match.rules).toEqual({ v: 1, style: 'limited', overs: 7, players: null, lastManStands: false, retireAt: null, bowlerOvers: null, extraRuns: 1, rebowl: true, freeHit: false, drawAllowed: true });
  });
  it('the standards equal the engines’ constants (rally SET_CONFIG, MATCH_LENGTHS)', () => {
    for (const [sport, cfg] of Object.entries(SET_CONFIG)) {
      const r = SPORT_RULES[sport]!;
      expect([r.target, r.cap ?? undefined, r.finalTarget ?? undefined, r.winBy2, r.bestOf]).toEqual([cfg.target, cfg.cap, cfg.finalTarget, cfg.winBy2, cfg.maxSets]);
    }
    for (const [sport, len] of Object.entries(MATCH_LENGTHS)) expect(SPORT_RULES[sport]!.bestOf).toBe(len.standard);
    expect(rulesFromLegacy('cricket', null, null).overs).toBe(20);
  });
});
