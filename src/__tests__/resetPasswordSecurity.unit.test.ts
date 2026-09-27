/**
 * /auth/reset-password security (28 Sep 2026).
 *  - 5 wrong codes for a number and its code is gone (every code-checking
 *    endpoint goes through utils/otpCheck);
 *  - verify-otp's marker only stands in for the code it was earned with — it
 *    used to be a bare 'VERIFIED' that reset-password accepted with ANY code;
 *  - reset needs a code sent for 'reset';
 *  - reset answers 404 when no live account has the number (it said success);
 *  - reset-password and verify-otp get their own per-IP and per-number limits.
 */
import fs from 'fs';
import path from 'path';

const store = new Map<string, { code: string; purpose: string }>();
const mockCtr = new Map<string, number>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async (phone: string, code: string, purpose: string) => { store.set(phone, { code, purpose }); }),
  getOtp: jest.fn(async (phone: string) => store.get(phone) ?? null),
  deleteOtp: jest.fn(async (phone: string) => { store.delete(phone); }),
  bumpCounter: jest.fn(async (k: string) => { const n = (mockCtr.get(k) ?? 0) + 1; mockCtr.set(k, n); return n; }),
  readCounter: jest.fn(async (k: string) => mockCtr.get(k) ?? 0),
  clearCounter: jest.fn(async (k: string) => { mockCtr.delete(k); }),
}));
let updatedRows: Array<{ id: string }> = [];
const calls: string[] = [];
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'update', 'in', 'is', 'eq', 'not', 'limit', 'maybeSingle']) chain[m] = jest.fn((...a: unknown[]) => { calls.push(`${m}:${JSON.stringify(a)}`); return chain; });
  chain.select = jest.fn(async () => ({ data: updatedRows, error: null }));
  return { supabase: chain };
});
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hash') }), { virtual: true });
jest.mock('bcrypt', () => ({ hash: jest.fn(async () => 'hash') }), { virtual: true });

// eslint-disable-next-line import/first
import { verifyOtp, resetPassword } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { checkOtpCode, verifiedMarker, MAX_WRONG_CODES } from '../utils/otpCheck';
// eslint-disable-next-line import/first
import { deleteOtp } from '../utils/otpStore';

const P = '+919000000001';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, body: object) => { const r = res(); await fn({ body } as any, r); return r; };

beforeEach(() => {
  mockCtr.clear();
  store.clear();
  updatedRows = [{ id: 'u1' }];
  calls.length = 0;
  (deleteOtp as jest.Mock).mockClear();
  delete process.env.ALLOW_TEST_OTP;
});

describe('5 wrong codes and the code is gone', () => {
  test('4 wrong → still "wrong"; the 5th → locked and the code deleted; then even the right code fails', async () => {
    store.set(P, { code: '482913', purpose: 'reset' });
    for (let i = 1; i < MAX_WRONG_CODES; i++) expect(await checkOtpCode(P, '000000')).toBe('wrong');
    expect(await checkOtpCode(P, '000000')).toBe('locked');
    expect(deleteOtp).toHaveBeenCalledWith(P);
    expect(await checkOtpCode(P, '482913')).toBe('locked');
  });
  test('a new code starts a new count (the lock is on the code, not the number)', () => {
    const auth = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'auth.controller.ts'), 'utf8');
    expect(auth).toMatch(/await setOtp\(p, code, purpose, OTP_TTL_SECONDS\);\s*await clearWrongCodes\(p\);/);
  });
  test('a right code clears the count', async () => {
    store.set(P, { code: '482913', purpose: 'reset' });
    for (let i = 1; i < MAX_WRONG_CODES; i++) await checkOtpCode(P, '000000');
    expect(await checkOtpCode(P, '482913')).toBe('ok');
    expect(await checkOtpCode(P, '000000')).toBe('wrong'); // counting from zero again
  });
  test('through the endpoints: 429 OTP_LOCKED on the 5th wrong code', async () => {
    store.set(P, { code: '482913', purpose: 'reset' });
    let r: any;
    for (let i = 0; i < MAX_WRONG_CODES; i++) r = await call(resetPassword, { phone: '9000000001', code: '111111', newPassword: 'longenough1' });
    expect(r.statusCode).toBe(429);
    expect(r.body.code).toBe('OTP_LOCKED');
    expect(store.has(P)).toBe(false);
  });
});

describe('the verified marker only works with its own code (the old hole)', () => {
  test('verify-otp, then reset-password with a DIFFERENT code → refused; with the same code → reset', async () => {
    store.set(P, { code: '482913', purpose: 'reset' });
    const v = await call(verifyOtp, { phone: '9000000001', code: '482913' });
    expect(v.body).toEqual({ success: true, verified: true });
    expect(store.get(P)).toEqual({ code: verifiedMarker('482913'), purpose: 'reset' });
    const bad = await call(resetPassword, { phone: '9000000001', code: '999999', newPassword: 'longenough1' });
    expect(bad.statusCode).toBe(400);
    const ok = await call(resetPassword, { phone: '9000000001', code: '482913', newPassword: 'longenough1' });
    expect(ok.body).toEqual({ success: true });
  });
  test('a bare VERIFIED (the old marker) stands in for nothing', async () => {
    store.set(P, { code: 'VERIFIED', purpose: 'reset' });
    expect(await checkOtpCode(P, '123456')).toBe('wrong');
  });
});

describe('reset needs a reset code, and a live account', () => {
  test('a code sent for sign-in can\'t reset a password', async () => {
    store.set(P, { code: '482913', purpose: 'login' });
    const r = await call(resetPassword, { phone: '9000000001', code: '482913', newPassword: 'longenough1' });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('OTP_WRONG_PURPOSE');
  });
  test('no live account with the number → 404, not "success"', async () => {
    store.set(P, { code: '482913', purpose: 'reset' });
    updatedRows = [];
    const r = await call(resetPassword, { phone: '9000000001', code: '482913', newPassword: 'longenough1' });
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'No SportClan account uses this number.', code: 'PHONE_NOT_REGISTERED' });
    expect(store.has(P)).toBe(false); // the code is used up either way
  });
  test('only live accounts are updated', async () => {
    store.set(P, { code: '482913', purpose: 'reset' });
    await call(resetPassword, { phone: '9000000001', code: '482913', newPassword: 'longenough1' });
    expect(calls).toContain('is:["deleted_at",null]');
  });
});

describe('limits in front of reset-password and verify-otp', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
  test('per IP and per number, before the /auth routes', () => {
    const mount = "app.use(['/auth/reset-password', '/auth/verify-otp'], resetCheckIpLimiter, resetCheckNumberLimiter);";
    expect(idx).toContain(mount);
    expect(idx.indexOf(mount)).toBeLessThan(idx.indexOf("app.use('/auth', authLimiter, authRoutes)"));
    expect(idx).toMatch(/const resetCheckIpLimiter = rateLimit\(\{\s*windowMs: 15 \* 60 \* 1000,\s*max: 10,/);
    expect(idx).toMatch(/const resetCheckNumberLimiter = rateLimit\(\{\s*windowMs: 60 \* 60 \* 1000,\s*max: 10,[\s\S]*?canonicalisePhone\(raw\)[\s\S]*?`rnum:\$\{p\}`/);
  });
  test('every endpoint that takes a code uses the one check', () => {
    const auth = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'auth.controller.ts'), 'utf8');
    expect((auth.match(/await checkOtpCode\(p, code/g) ?? []).length).toBe(5);
    expect(auth).not.toMatch(/entry\.code !== 'VERIFIED'/);
  });
});

describe('send-otp: per-number limit (5 an hour, 10 a day), allowlisted numbers too', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sendOtp, SEND_PER_NUMBER_HOUR, SEND_PER_NUMBER_DAY } = require('../controllers/auth.controller');
  const send = (phone = '9000000001') => call(sendOtp, { phone, purpose: 'login' });
  beforeEach(() => {
    process.env.OTP_TEST_NUMBERS = '9000000001';
    process.env.OTP_TEST_CODE = '246810';
    updatedRows = [];
  });
  afterEach(() => { delete process.env.OTP_TEST_NUMBERS; delete process.env.OTP_TEST_CODE; });
  test('the 6th send in an hour → 429 OTP_SEND_LIMIT (allowlisted number, no SMS either way)', async () => {
    expect([SEND_PER_NUMBER_HOUR, SEND_PER_NUMBER_DAY]).toEqual([5, 10]);
    for (let i = 0; i < 5; i++) expect((await send()).statusCode).toBe(200);
    const r = await send();
    expect(r.statusCode).toBe(429);
    expect(r.body).toEqual({ error: 'Too many codes sent to this number. Try again in an hour.', code: 'OTP_SEND_LIMIT' });
    expect((await send('9000000002')).statusCode).not.toBe(429); // another number is unaffected
  });
  test('10 a day, even across hours', async () => {
    for (let i = 0; i < 5; i++) await send();
    mockCtr.delete('sendh:+919000000001'); // the hour window rolls over
    for (let i = 0; i < 5; i++) expect((await send()).statusCode).toBe(200);
    mockCtr.delete('sendh:+919000000001');
    const r = await send();
    expect(r.statusCode).toBe(429);
    expect(r.body.error).toBe('Too many codes sent to this number today. Try again tomorrow.');
  });
});
