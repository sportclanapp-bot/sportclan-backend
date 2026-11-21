/**
 * Q37 (Dipak, 21 Nov 2026: A) · N-R6-E003: a pro account set to "Who can find you: No one" was
 * still listed (and counted) in Services. Services now applies the same rule as search: No one →
 * only themselves; Followers → only people who follow them. It is a PostgREST `or` on the embedded
 * user in every Services query (type list, officials' cards, counts), so totals stay true.
 * Supabase is a recording chain: every from() starts its own query.
 */
type Q = string[];
let mockLog: Q[] = [];
const FOLLOWED = '33333333-3333-4333-8333-333333333333';
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'eq', 'is', 'in', 'not', 'or', 'order', 'range', 'neq']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok(t === 'follow_relationships'
      ? { data: q.some((c) => c.startsWith('range:[0,')) ? [{ following_id: FOLLOWED }] : [], error: null }
      : { data: [], error: null, count: 0 }));
    return chain;
  };
  return { supabase: { from: jest.fn(start) } };
});
jest.mock('../utils/blocks', () => ({ blockedUserIds: jest.fn(async () => new Set<string>()), excludeIds: jest.fn((q: unknown) => q) }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTestEmbed: jest.fn((q: unknown) => q) }));
jest.mock('../middleware/auth.middleware', () => ({ authenticateToken: (_q: unknown, _s: unknown, n: () => void) => n() }));
// eslint-disable-next-line import/first
import router from '../routes/services.routes';

const ME = '11111111-1111-4111-8111-111111111111';
const res = () => { const r: any = { statusCode: 200 }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const run = async (path: string, query: Record<string, string>) => {
  const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route.methods.get);
  const hs = layer.route.stack.map((s: any) => s.handle);
  const r = res(); await hs[hs.length - 1]({ userId: ME, query, headers: {} }, r); return r;
};
const FILTER = `discoverability.is.null,discoverability.eq.everyone,and(discoverability.eq.followers,id.in.(${FOLLOWED})),id.eq.${ME}`;
const ors = () => mockLog.filter((q) => q[0] === 'from:user_account_types').map((q) => q.find((c) => c.startsWith('or:')));

beforeEach(() => { mockLog = []; });

test('the type list keeps only findable providers (No one hidden, Followers only if followed, yourself always)', async () => {
  await run('/', { type: 'coach' });
  expect(ors()).toEqual([`or:${JSON.stringify([FILTER, { referencedTable: 'users' }])}`]);
});
test('the counts and the officials’ cards use the same rule', async () => {
  await run('/counts', {});
  const o = ors();
  expect(o.length).toBeGreaterThan(1);
  for (const x of o) expect(x).toBe(`or:${JSON.stringify([FILTER, { referencedTable: 'users' }])}`);
});
test('the officials’ category list too', async () => {
  await run('/', { category: 'umpires' });
  expect(ors()).toEqual([`or:${JSON.stringify([FILTER, { referencedTable: 'users' }])}`]);
});
