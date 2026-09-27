/**
 * OTP test-number allowlist (28 Sep 2026). Listed numbers get OTP_TEST_CODE and
 * no SMS; every other number is unchanged; empty / unset / malformed config
 * turns it off. Behavioural against sendOtp / verifyOtp with the SMS provider
 * (axios), the OTP store and Supabase mocked.
 */
import fs from 'fs';
import path from 'path';

const store = new Map<string, { code: string; purpose: string }>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async (phone: string, code: string, purpose: string) => { store.set(phone, { code, purpose }); }),
  getOtp: jest.fn(async (phone: string) => store.get(phone) ?? null),
  deleteOtp: jest.fn(async (phone: string) => { store.delete(phone); }),
}));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { Status: 'Success', Details: 'sess' } })) } }));
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'in', 'not', 'eq', 'is', 'maybeSingle', 'update', 'insert']) chain[m] = jest.fn(() => chain);
  chain.limit = jest.fn(async () => ({ data: [], error: null }));
  return { supabase: chain };
});

// eslint-disable-next-line import/first
import axios from 'axios';
// eslint-disable-next-line import/first
import { sendOtp, verifyOtp } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { otpTestConfig, testCodeFor, maskPhone } from '../utils/otpTestNumbers';

const get = (axios as unknown as { get: jest.Mock }).get;
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const send = async (phone: string, purpose = 'login') => {
  const r = res();
  await sendOtp({ body: { phone, purpose } } as any, r);
  return r;
};

const ENV = { ...process.env };
beforeEach(() => {
  store.clear();
  get.mockClear();
  process.env = { ...ENV, TWOFACTOR_API_KEY: 'k-test', OTP_TEST_NUMBERS: '9876500001, +91 98765 00002', OTP_TEST_CODE: '246810' };
  delete process.env.ALLOW_TEST_OTP;
});
afterAll(() => { process.env = ENV; });

describe('config', () => {
  test('parses any common form into canonical numbers', () => {
    const c = otpTestConfig({ OTP_TEST_NUMBERS: '9876500001, +91 98765 00002,919876500003', OTP_TEST_CODE: '246810' } as any)!;
    expect([...c.numbers].sort()).toEqual(['+919876500001', '+919876500002', '+919876500003']);
  });
  test('empty, unset or malformed → off', () => {
    expect(otpTestConfig({ OTP_TEST_NUMBERS: '', OTP_TEST_CODE: '246810' } as any)).toBeNull();
    expect(otpTestConfig({ OTP_TEST_CODE: '246810' } as any)).toBeNull();
    expect(otpTestConfig({ OTP_TEST_NUMBERS: '9876500001' } as any)).toBeNull();
    expect(otpTestConfig({ OTP_TEST_NUMBERS: '9876500001', OTP_TEST_CODE: '12345' } as any)).toBeNull();
    expect(otpTestConfig({ OTP_TEST_NUMBERS: 'not-a-number', OTP_TEST_CODE: '246810' } as any)).toBeNull();
  });
  test('only exact listed numbers match', () => {
    expect(testCodeFor('+919876500001')).toBe('246810');
    expect(testCodeFor('+919876500009')).toBeNull();
    expect(maskPhone('+919876500001')).toBe('+91 •••••• 0001');
  });
});

describe('a listed number: no SMS, the fixed code', () => {
  test.each(['login', 'register', 'change_phone', 'reset'])('purpose %s', async (purpose) => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const r = await send('98765 00001', purpose);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ success: true, message: 'OTP sent', channel: 'sms' });
    expect(get).not.toHaveBeenCalled();                       // nothing sent
    expect(store.get('+919876500001')).toEqual({ code: '246810', purpose });
    // logged at info, masked, and never with the code
    expect(info).toHaveBeenCalledWith(`[otp-test] +91 •••••• 0001 purpose=${purpose}: test code stored, no SMS sent`);
    expect(info.mock.calls.flat().join(' ')).not.toContain('246810');
    info.mockRestore();
  });
  test('the fixed code verifies; a wrong code does not', async () => {
    await send('+91 98765 00002');
    const ok = res();
    await verifyOtp({ body: { phone: '9876500002', code: '246810' } } as any, ok);
    expect(ok.body).toEqual({ success: true, verified: true });
    await send('+91 98765 00002');
    const bad = res();
    await verifyOtp({ body: { phone: '9876500002', code: '111111' } } as any, bad);
    expect(bad.statusCode).toBe(400);
  });
});

describe('every other number behaves exactly as now', () => {
  test('an unlisted number still goes to the SMS provider, with a fresh code', async () => {
    const r = await send('9876500009');
    expect(r.statusCode).toBe(200);
    expect(get).toHaveBeenCalledTimes(1);
    expect(String(get.mock.calls[0][0])).toMatch(/2factor\.in\/API\/V1\/k-test\/SMS\/9876500009\/\d{6}/);
    expect(store.get('+919876500009')?.code).toMatch(/^\d{6}$/);
  });
  test('the fixed code does NOT verify an unlisted number', async () => {
    await send('9876500009');
    const r = res();
    await verifyOtp({ body: { phone: '9876500009', code: '246810' } } as any, r);
    // (a random code can equal 246810 once in 900,000 — accepted as noise)
    if (store.get('+919876500009')?.code !== '246810') expect(r.statusCode).toBe(400);
  });
  test('an empty OTP_TEST_NUMBERS turns it off — a listed number is texted again', async () => {
    process.env.OTP_TEST_NUMBERS = '';
    await send('9876500001');
    expect(get).toHaveBeenCalledTimes(1);
  });
  test('an unset OTP_TEST_CODE turns it off too', async () => {
    delete process.env.OTP_TEST_CODE;
    await send('9876500001');
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('the four flows and the rate limits', () => {
  const auth = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'auth.controller.ts'), 'utf8');
  const body = (name: string) => {
    const s = auth.indexOf(`export async function ${name}(`);
    const e = auth.indexOf('\nexport ', s + 10);
    return auth.slice(s, e === -1 ? undefined : e);
  };
  test.each(['otpLogin', 'register', 'changePhone', 'resetPassword'])('%s checks the stored code, so the test code works there', (fn) => {
    expect(body(fn)).toMatch(/await getOtp\(p\)/);
  });
  test('sends are rate-limited before the controller runs', () => {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    expect(idx.indexOf("app.use('/auth/send-otp', sendOtpLimiter)")).toBeGreaterThan(-1);
    expect(idx.indexOf("app.use('/auth/send-otp', sendOtpLimiter)")).toBeLessThan(idx.indexOf("app.use('/auth', authLimiter, authRoutes)"));
  });
});
