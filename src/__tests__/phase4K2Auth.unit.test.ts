/**
 * Phase 4 · K2 — regression tests for auth / admin hardening: the OTP vendor
 * call timeout, refresh after a ban, suspend revoking sessions (see the app
 * repo's phase4/K2.md). Supabase is mocked: every `from()` starts its own
 * query, resolved by `mockNext(q)`. The SMS vendor (axios) is mocked — no
 * network, no real OTP.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert']) {
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
const store = new Map<string, { code: string; purpose: string }>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async (phone: string, code: string, purpose: string) => { store.set(phone, { code, purpose }); }),
  getOtp: jest.fn(async (phone: string) => store.get(phone) ?? null),
  deleteOtp: jest.fn(async (phone: string) => { store.delete(phone); }),
  bumpCounter: jest.fn(async () => 1),
  readCounter: jest.fn(async () => 0),
  clearCounter: jest.fn(async () => undefined),
}));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { Status: 'Success', Details: 'sess' } })) } }));
jest.mock('../utils/jwt', () => ({
  ...jest.requireActual('../utils/jwt'),
  verifyRefreshToken: jest.fn(() => ({ userId: 'u1' })),
  generateAccessToken: jest.fn(() => 'fresh-access'),
}));
const mockRevokeNow = jest.fn(async (..._a: unknown[]) => Date.now());
jest.mock('../utils/sessionRevocation', () => ({ ...jest.requireActual('../utils/sessionRevocation'), revokeSessionsNow: (...a: unknown[]) => mockRevokeNow(...a) }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), logAdminAction: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import axios from 'axios';
// eslint-disable-next-line import/first
import { sendOtp, refresh } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { adminUpdateUser } from '../controllers/admin.controller';

const get = (axios as unknown as { get: jest.Mock }).get;
const TARGET = '22222222-2222-4222-8222-222222222222';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const ENV = { ...process.env };

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  store.clear();
  get.mockClear();
  mockRevokeNow.mockClear();
  // A dummy vendor key so the code takes the vendor path (axios is mocked);
  // no test-number allowlist, so this is the ordinary send path.
  process.env = { ...ENV, TWOFACTOR_API_KEY: 'k-test' };
  delete process.env.OTP_TEST_NUMBERS;
  delete process.env.OTP_TEST_CODE;
});
afterAll(() => { process.env = ENV; });

describe('K2-29 · the OTP vendor call can’t hang the request (SC-150)', () => {
  it('K2-29b (c41b2a4): every 2Factor.in request carries an 8s timeout', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: [{ id: 'u-live' }] } : { data: null });
    const r = res();
    await sendOtp({ body: { phone: '9876512345', purpose: 'login' }, headers: {} } as any, r);
    expect(get).toHaveBeenCalled();
    for (const call of get.mock.calls) expect(call[1]).toMatchObject({ timeout: 8000 });
  });
});

describe('K2-34 · a ban bites mid-session (SC-213)', () => {
  const doRefresh = async () => { const r = res(); await refresh({ body: { refreshToken: 'rt' }, headers: {} } as any, r); return r; };
  it('K2-34a (6487a48): refresh for a suspended account → 403, no access token', async () => {
    mockNext = (q) => (q[0] === 'from:refresh_tokens' ? { data: { id: 'row-1', revoked: false } }
      : q[0] === 'from:users' && q.some((c) => c.includes('suspended_at')) ? { data: { suspended_at: '2026-09-01T00:00:00Z' } } : { data: null });
    const r = await doRefresh();
    expect(r.statusCode).toBe(403);
    expect(r.body.accessToken).toBeUndefined();
  });
  it('K2-34a (6487a48): refresh for a soft-deleted account → 403 ACCOUNT_DELETED', async () => {
    mockNext = (q) => (q[0] === 'from:refresh_tokens' ? { data: { id: 'row-1', revoked: false } }
      : q[0] === 'from:users' && q.some((c) => c.includes('"deleted_at"')) ? { data: { deleted_at: '2026-09-01T00:00:00Z' } } : { data: null });
    const r = await doRefresh();
    expect([r.statusCode, r.body.code]).toEqual([403, 'ACCOUNT_DELETED']);
  });
  it('K2-34a (6487a48): a live account still refreshes', async () => {
    mockNext = (q) => (q[0] === 'from:refresh_tokens' ? { data: { id: 'row-1', revoked: false } } : { data: null });
    expect((await doRefresh()).body).toEqual({ accessToken: 'fresh-access' });
  });
  it('K2-34b (6487a48): suspending a user revokes all their live refresh tokens', async () => {
    mockNext = (q) => (q[0] === 'from:users' && q.some((c) => c.startsWith('update:')) ? { data: { id: TARGET } }
      : q[0] === 'from:users' ? { data: { id: TARGET, deleted_at: null, is_admin: false } } : { data: null });
    const r = res();
    await adminUpdateUser({ userId: 'admin-1', params: { id: TARGET }, body: { suspended: true }, headers: {} } as any, r);
    expect(r.statusCode).toBe(200);
    const rev = mockLog.find((q) => q[0] === 'from:refresh_tokens' && q.some((c) => c.startsWith('update:')))!;
    expect(rev).toEqual(expect.arrayContaining(['update:[{"revoked":true}]', `eq:["user_id","${TARGET}"]`]));
  });
});
