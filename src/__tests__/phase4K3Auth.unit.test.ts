/**
 * Phase 4 · K3 — auth / phone regressions (SC-385/386/398/399). Supabase, the
 * OTP store and the SMS provider (axios) are mocked: nothing is ever sent.
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
const mockStore = new Map<string, { code: string; purpose: string }>();
let mockSetFails = false;
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async (p: string, code: string, purpose: string) => { if (mockSetFails) throw new Error('no store'); mockStore.set(p, { code, purpose }); }),
  getOtp: jest.fn(async (p: string) => mockStore.get(p) ?? null),
  deleteOtp: jest.fn(async (p: string) => { mockStore.delete(p); }),
  bumpCounter: jest.fn(async () => 1),
  readCounter: jest.fn(async () => 0),
  clearCounter: jest.fn(async () => undefined),
}));
const mockGet = jest.fn(async (_url: string, _opts?: unknown) => ({ data: { Status: 'Success', Details: 'x' } }));
jest.mock('axios', () => ({ __esModule: true, default: { get: (url: string, opts?: unknown) => mockGet(url, opts) } }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hash'), compare: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import * as auth from '../controllers/auth.controller';

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, body: object, extra: object = {}) => { const r = res(); await fn({ body, headers: {}, ...extra } as any, r); return r; };
const ENV = { ...process.env };
const phoneIn = (q: Q) => q.find((c) => c.startsWith('in:["phone"'));

beforeEach(() => {
  mockLog = []; mockNext = () => ({ data: null, error: null });
  mockStore.clear(); mockSetFails = false; mockGet.mockClear();
  process.env = { ...ENV, TWOFACTOR_API_KEY: 'k-test' };
  delete process.env.OTP_TEST_NUMBERS; delete process.env.OTP_TEST_CODE; delete process.env.ALLOW_TEST_OTP; delete process.env.TWOFACTOR_SMS_TEMPLATE_ID;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => { process.env = ENV; });

describe('SC-385 · a phone number has to be one', () => {
  test.each(['notaphone', '12345', '98765432101234'])('K3-34 (c53b69d): send-otp %s → 400 INVALID_PHONE, nothing stored or sent', async (phone) => {
    const r = await call(auth.sendOtp, { phone, purpose: 'login' });
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_PHONE']);
    expect(mockStore.size).toBe(0);
    expect(mockGet).not.toHaveBeenCalled();
  });
  test('K3-34 (c53b69d): change-phone to "notaphone" → 400 INVALID_PHONE, nothing written', async () => {
    const r = await call(auth.changePhone, { newPhone: 'notaphone', code: '123456' }, { userId: 'u1' });
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_PHONE']);
    expect(mockLog.some((q) => q.some((c) => c.startsWith('update:')))).toBe(false);
  });
});

describe('SC-386 · one number, one account, whatever form it was typed in', () => {
  test('K3-35 (e08775c): a code is stored under the canonical +91 form', async () => {
    await call(auth.sendOtp, { phone: '098765 43210', purpose: 'login' });
    expect([...mockStore.keys()]).toEqual(['+919876543210']);
  });
  test('K3-35 (e08775c): sign-up with 9876543210 when +919876543210 (legacy 10-digit) is taken → PHONE_ALREADY_REGISTERED', async () => {
    mockStore.set('+919876543210', { code: '482913', purpose: 'register' });
    mockNext = (q) => (q[0] === 'from:users' && phoneIn(q)?.includes('"9876543210"') ? { data: [{ id: 'old', deleted_at: null }] } : { data: null });
    const r = await call(auth.register, { phone: '+91 98765 43210', code: '482913', name: 'Arjun', username: 'arjun_19' });
    expect([r.statusCode, r.body.code]).toEqual([400, 'PHONE_ALREADY_REGISTERED']);
    expect(phoneIn(mockLog.find((q) => phoneIn(q))!)).toContain('"+919876543210"');
  });
  test('K3-35 (e08775c): OTP login finds an account stored in the legacy form', async () => {
    mockStore.set('+919876543210', { code: '482913', purpose: 'login' });
    mockNext = (q) => (q[0] === 'from:users' && phoneIn(q)?.includes('"9876543210"') && q.includes('maybeSingle') ? { data: { id: 'u1', phone: '9876543210', deleted_at: null } } : { data: null });
    const r = await call(auth.otpLogin, { phone: '9876543210', code: '482913' });
    expect(r.statusCode).toBe(200);
    expect(r.body.user.id).toBe('u1');
  });
  test('K3-35 (e08775c): change-phone stores the canonical form and checks every stored form for a clash', async () => {
    mockStore.set('+919876543210', { code: '482913', purpose: 'change_phone' });
    mockNext = () => ({ data: null });
    const r = await call(auth.changePhone, { newPhone: '98765-43210', code: '482913' }, { userId: 'u1' });
    expect(r.body).toEqual({ success: true });
    const upd = mockLog.find((q) => q.some((c) => c.startsWith('update:') && c.includes('"phone"')))!;
    expect(upd.join()).toContain('update:[{"phone":"+919876543210"}]');
    mockLog = [];
    mockStore.set('+919876543210', { code: '482913', purpose: 'change_phone' });
    mockNext = (q) => (phoneIn(q)?.includes('"9876543210"') && q.includes('maybeSingle') ? { data: { id: 'other' } } : { data: null });
    const taken = await call(auth.changePhone, { newPhone: '+919876543210', code: '482913' }, { userId: 'u1' });
    expect(taken.statusCode).toBe(409);
  });
});

describe('SC-398 / SC-399 · sending the code', () => {
  test('K3-46 (7f73300): OTP storage down → 503 OTP_STORE_UNAVAILABLE, never a bare 500, nothing sent', async () => {
    mockSetFails = true;
    const r = await call(auth.sendOtp, { phone: '9876543210', purpose: 'login' });
    expect([r.statusCode, r.body.code]).toEqual([503, 'OTP_STORE_UNAVAILABLE']);
    expect(mockGet).not.toHaveBeenCalled();
  });
  test('K3-48 (860b339): with no channel asked for, the code goes by SMS, not voice', async () => {
    const r = await call(auth.sendOtp, { phone: '9876543210', purpose: 'login' });
    expect(r.body).toEqual({ success: true, message: 'OTP sent', channel: 'sms' });
    expect(String(mockGet.mock.calls[0][0])).toMatch(/\/SMS\/9876543210\//);
  });
  test('K3-48 (860b339): 2Factor answering 200 {Status:"Error"} is a failed send → 503 OTP_SEND_FAILED, not "OTP sent"', async () => {
    mockGet.mockResolvedValueOnce({ data: { Status: 'Error', Details: 'Insufficient balance' } } as any);
    const r = await call(auth.sendOtp, { phone: '9876543210', purpose: 'login' });
    expect([r.statusCode, r.body.code]).toEqual([503, 'OTP_SEND_FAILED']);
  });
});
