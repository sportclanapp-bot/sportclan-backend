/**
 * Phase 4 · K3 — profile / users regressions. Supabase is a recording chain:
 * every from()/rpc() starts its own query and resolves to mockNext(q).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal']) {
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

// eslint-disable-next-line import/first
import { updateMe } from '../controllers/users.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const updates = () => mockLog.filter((q) => q.some((c) => c.startsWith('update:')));

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('SC-365 · PATCH /users/me', () => {
  test.each(['admin', 'Support', 'SPORTCLAN'])('K3-10 (15a2c36): username %s → 400 USERNAME_RESERVED, nothing written', async (username) => {
    const r = await call(updateMe, { body: { username } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'USERNAME_RESERVED']);
    expect(updates()).toHaveLength(0);
  });
  test('K3-10 (15a2c36): "supporter" is not reserved (whole-name match only)', async () => {
    mockNext = (q) => (q.some((c) => c.includes('last_username_changed_at')) ? { data: { username: 'old_name' } } : { data: null });
    const r = await call(updateMe, { body: { username: 'supporter' } });
    expect(r.body?.code).not.toBe('USERNAME_RESERVED');
  });
  test.each(['', '   '])('K3-10 (15a2c36): name %j → 400 INVALID_NAME', async (name) => {
    const r = await call(updateMe, { body: { name } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_NAME']);
    expect(updates()).toHaveLength(0);
  });
  test('K3-10 (15a2c36): "not-an-email" → 400 INVALID_EMAIL', async () => {
    const r = await call(updateMe, { body: { email: 'not-an-email' } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_EMAIL']);
    expect(updates()).toHaveLength(0);
  });
  test('K3-10 (15a2c36): an email another account holds → 409 EMAIL_TAKEN; a free one is saved lower-cased', async () => {
    mockNext = (q) => (q.some((c) => c.startsWith('ilike:["email"')) ? { data: { id: OTHER } } : { data: null });
    const r = await call(updateMe, { body: { email: 'Taken@Example.com' } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'EMAIL_TAKEN']);
    mockLog = [];
    mockNext = (q) => (q.some((c) => c.startsWith('update:')) ? { data: { id: ME } } : { data: null });
    await call(updateMe, { body: { email: ' Me@Example.COM ' } });
    expect(updates()[0].join()).toContain('"email":"me@example.com"');
  });
});
