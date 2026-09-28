/**
 * Phase 4 · K3 — what match lists may show (M2 voided, M3 past-dated) and the
 * unplayed sweep. matchVoid/matchStaleness tests pin the predicates; these pin
 * that the list handlers apply them. Supabase is a recording chain.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal', 'like', 'not', 'csv']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const done = () => ({ data: null, error: null, ...mockNext(q) });
    chain.single = jest.fn(async () => { q.push('single'); return done(); });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); return done(); });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(done())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, args?: unknown) => start(`rpc:${n}:${JSON.stringify(args ?? null)}`)) } };
});
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), activeSportIds: jest.fn(async () => null) }));
jest.mock('../utils/testContent', () => ({ ...jest.requireActual('../utils/testContent'), hideTestFor: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import { listMatches, listOpenMatches, sweepUnplayedScheduledMatches, DISCOVERY_GRACE_HOURS } from '../controllers/matches.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-09-22T12:00:00.000Z');
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const list = async (fn: any, query: object) => { const r = res(); await fn({ userId: ME, params: {}, query, body: {}, headers: {} }, r); return r; };
const matchesQ = () => mockLog.find((q) => q[0] === 'from:matches' && q.some((c) => c.startsWith('select:["*"')))!.join();
const cutoff = new Date(NOW - DISCOVERY_GRACE_HOURS * 3600_000).toISOString();

beforeEach(() => {
  mockLog = []; mockNext = () => ({ data: [], count: 0 });
  jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'setTimeout', 'setInterval', 'nextTick', 'queueMicrotask', 'clearTimeout', 'clearInterval', 'clearImmediate'] });
});
afterEach(() => jest.useRealTimers());

describe('M2 · a voided match is not live and not upcoming', () => {
  it.each([['live', 'live'], ['scheduled', 'scheduled'], ['unscoped', undefined]])('K3-61 (1aa2103): the %s list drops voided matches', async (_label, status) => {
    await list(listMatches, status ? { status } : {});
    expect(matchesQ()).toContain('is:["voided_at",null]');
  });
  it('K3-61 (1aa2103): history keeps them — your own list and a finished list', async () => {
    await list(listMatches, { status: 'live', mine: '1' });
    expect(matchesQ()).not.toContain('voided_at');
    mockLog = [];
    await list(listMatches, { status: 'completed' });
    expect(matchesQ()).not.toContain('voided_at');
  });
});

describe('M3 · past-dated matches stop being discoverable, and get swept', () => {
  it('K3-62 (9e64a7a): the scheduled list and the open-match finder only offer matches after the 6h grace cutoff', async () => {
    await list(listMatches, { status: 'scheduled' });
    expect(matchesQ()).toContain(`gte:["scheduled_at","${cutoff}"]`);
    mockLog = [];
    await list(listOpenMatches, {});
    expect(matchesQ()).toContain(`gte:["scheduled_at","${cutoff}"]`);
  });
  it('K3-62 (9e64a7a): a live list is not date-filtered (a late start is never hidden mid-game)', async () => {
    await list(listMatches, { status: 'live' });
    expect(matchesQ()).not.toContain('gte:["scheduled_at"');
  });
  it('K3-62 (9e64a7a): a scheduled match 48h past its start is marked abandoned (never deleted)', async () => {
    mockNext = (q) => (q.some((c) => c.startsWith('select:')) ? { data: [{ id: 'm1' }, { id: 'm2' }] } : { data: null });
    const out = await sweepUnplayedScheduledMatches();
    expect(out).toEqual({ abandoned: 2 });
    const sel = mockLog[0].join();
    expect(sel).toContain('eq:["status","scheduled"]');
    expect(sel).toContain(`lt:["scheduled_at","${new Date(NOW - 48 * 3600_000).toISOString()}"]`);
    const upd = mockLog.find((q) => q.some((c) => c.startsWith('update:')))!.join();
    expect(upd).toContain('"status":"abandoned"');
    expect(upd).toContain('in:["id",["m1","m2"]]');
    expect(mockLog.some((q) => q.some((c) => c.startsWith('delete:')))).toBe(false);
  });
});
