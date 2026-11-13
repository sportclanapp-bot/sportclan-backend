type Q = string[];
type Ans = { rows?: unknown[]; one?: unknown; error?: unknown };
let mockLog: Q[] = [];
let mockDb: (q: Q) => Ans = () => ({ rows: [] });
jest.mock('../utils/supabase', () => {
  const arg = (q: Q, m: string) => { const c = q.find((x) => x.startsWith(`${m}:`)); return c ? JSON.parse(c.slice(m.length + 1)) : null; };
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const answer = () => {
      const a = mockDb(q);
      if (a.error) return { data: null, error: a.error };
      if (a.one !== undefined) return { data: a.one, error: null };
      const all = a.rows ?? [];
      const sel = arg(q, 'select');
      if (sel && sel[1]?.head) return { data: null, error: null, count: all.length };
      const r = arg(q, 'range');
      const lim = arg(q, 'limit');
      let rows = r ? all.slice(r[0], r[1] + 1) : all.slice(0, 1000);
      if (lim) rows = rows.slice(0, lim[0]);
      return { data: rows, error: null, count: sel && sel[1]?.count ? all.length : null };
    };
    chain.single = jest.fn(async () => { q.push('single'); const x = answer(); return { ...x, data: Array.isArray(x.data) ? x.data[0] ?? null : x.data }; });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); const x = answer(); return { ...x, data: Array.isArray(x.data) ? x.data[0] ?? null : x.data }; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(answer())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string) => start(`rpc:${n}`)) } };
});
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => new Set()),
  targetUserHidden: jest.fn(async () => false),
  isBlockedBetween: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({ ...jest.requireActual('../utils/testContent'), hideTestFor: jest.fn(async () => true), testUserIdSet: jest.fn(async () => new Set()) }));

// eslint-disable-next-line import/first
import { listMatches } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { followCounts, getFollowers, getFollowing } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { hideTestFor } from '../utils/testContent';

/**
 * N-R7-S153 (X2-207) · a real viewer saw a test account in someone's Followers list and in the
 * '4 followers' header (3 real): the follow lists and counts skipped the test filter every other
 * discovery read uses. N-R7-S154 (SIDE-A4-1) · GET /matches (Sport hub) dropped flagged matches
 * but not an unflagged match against a TEST team, whose name then showed to real users.
 * PRODUCT CHOICE (confirm in step 3): such a match is hidden from discovery lists for a real viewer;
 * history scopes (mine / team / tournament) keep it.
 */
const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const call = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: ME, params: {}, query: {}, body: {}, ...req } as any, r);
  return r;
};
beforeEach(() => { mockLog = []; mockDb = () => ({ rows: [] }); (hideTestFor as jest.Mock).mockResolvedValue(true); });

test('S153: Followers / Following lists drop test accounts for a real viewer', async () => {
  for (const fn of [getFollowers, getFollowing]) {
    mockLog = [];
    const r = await call(fn, { params: { id: T } });
    expect(r.statusCode).toBe(200);
    const list = mockLog.find((x) => x[0] === 'from:follow_relationships' && has(x, 'range:'))!;
    expect(list).toContain('eq:["users.is_test_seed",false]');
  }
});

test('S153: the follower / following counts drop them too; a test viewer still sees everything', async () => {
  await followCounts(T, ME);
  const counts = mockLog.filter((x) => x[0] === 'from:follow_relationships');
  expect(counts).toHaveLength(2);
  for (const c of counts) expect(c).toContain('eq:["u.is_test_seed",false]');
  mockLog = [];
  (hideTestFor as jest.Mock).mockResolvedValue(false);
  await followCounts(T, ME);
  for (const c of mockLog) expect(c.some((x) => x.includes('is_test_seed'))).toBe(false);
});

test('S154: Sport hub list leaves out a match against a test team; history scopes keep it', async () => {
  mockDb = (q) => (q[0] === 'from:matches' ? { rows: [{ id: 'm1', xta: null, xtb: null }] } : { rows: [] });
  const r = await call(listMatches, { query: { status: 'scheduled' } });
  expect(r.statusCode).toBe(200);
  const list = mockLog.find((x) => x[0] === 'from:matches' && has(x, 'range:'))!;
  expect(list.find((x) => x.startsWith('select:'))).toContain('xta:teams!team_a_id(id), xtb:teams!team_b_id(id)');
  for (const s of ['eq:["xta.is_test_seed",true]', 'is:["xta",null]', 'eq:["xtb.is_test_seed",true]', 'is:["xtb",null]']) expect(list).toContain(s);
  expect(r.body.matches[0]).toEqual({ id: 'm1' }); // the filter embeds are not sent
  mockLog = [];
  await call(listMatches, { query: { team_id: T } });
  const hist = mockLog.find((x) => x[0] === 'from:matches' && has(x, 'range:'))!;
  expect(hist.some((x) => x.includes('xta'))).toBe(false);
});
