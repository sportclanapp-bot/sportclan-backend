/**
 * Q13 (Dipak, 21 Nov 2026, F016) · sign-in codes per connection 5 → 50 an hour with clearer
 * words, and a daily total-SMS cap (SMS_DAILY_CAP, default 2000 per IST day) with an alert
 * (console.error + Sentry) once at 80% and once at the cap. Only SMS that really went out are
 * counted; at the cap /auth/send-otp answers 503 SMS_DAILY_CAP and sends nothing.
 * The SMS provider (axios), the OTP store, Supabase and Sentry are mocked.
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
const mockSms = { ok: true };
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: mockSms.ok ? { Status: 'Success', Details: 'sess' } : { Status: 'Error', Details: 'x' } })) } }));
jest.mock('../utils/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'in', 'not', 'eq', 'is', 'maybeSingle', 'update', 'insert']) chain[m] = jest.fn(() => chain);
  chain.limit = jest.fn(async () => ({ data: [{ id: 'u-live' }], error: null }));
  return { supabase: chain };
});
// eslint-disable-next-line import/first
import axios from 'axios';
// eslint-disable-next-line import/first
import { sendOtp } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { smsDailyCap, countSmsSent, smsCapReached, SMS_DAILY_CAP_DEFAULT } from '../utils/smsDailyCap';
// eslint-disable-next-line import/first
import { captureError } from '../utils/sentry';

const get = (axios as unknown as { get: jest.Mock }).get;
const sentry = captureError as unknown as jest.Mock;
const send = async (phone: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await sendOtp({ body: { phone, purpose: 'login' } } as any, r);
  return r;
};
const smsToday = () => [...mockCtr.entries()].filter(([k]) => k.startsWith('smsday:')).reduce((a, [, v]) => a + v, 0);

const ENV = { ...process.env };
let err: jest.SpyInstance;
beforeEach(() => {
  mockCtr.clear(); store.clear(); get.mockClear(); sentry.mockClear(); mockSms.ok = true;
  process.env = { ...ENV, TWOFACTOR_API_KEY: 'k-test', SMS_DAILY_CAP: '5' };
  delete process.env.OTP_TEST_NUMBERS; delete process.env.OTP_TEST_CODE; delete process.env.ALLOW_TEST_OTP;
  err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => err.mockRestore());
afterAll(() => { process.env = ENV; });

describe('the cap value', () => {
  test('SMS_DAILY_CAP, default 2000 when unset, 0 or malformed', () => {
    expect(SMS_DAILY_CAP_DEFAULT).toBe(2000);
    expect(smsDailyCap({} as any)).toBe(2000);
    expect(smsDailyCap({ SMS_DAILY_CAP: '0' } as any)).toBe(2000);
    expect(smsDailyCap({ SMS_DAILY_CAP: 'lots' } as any)).toBe(2000);
    expect(smsDailyCap({ SMS_DAILY_CAP: ' 750 ' } as any)).toBe(750);
  });
});

describe('alerts', () => {
  test('one alert at 80% and one at the cap, each logged and sent to Sentry once', async () => {
    process.env.SMS_DAILY_CAP = '10';
    for (let i = 0; i < 12; i++) await countSmsSent();
    const lines = err.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[sms-cap]'));
    expect(lines).toEqual([
      '[sms-cap] 8 of 10 daily SMS used (80%)',
      '[sms-cap] daily SMS cap reached (10/10); sign-in codes are refused until midnight IST',
    ]);
    expect(sentry).toHaveBeenCalledTimes(2);
    expect(sentry.mock.calls[1][1]).toMatchObject({ kind: 'sms_daily_cap', used: 10, cap: 10 });
  });
  test('the count is per IST day', async () => {
    process.env.SMS_DAILY_CAP = '2';
    const d1 = new Date('2026-11-21T18:20:00Z'); // 23:50 IST, 21 Nov
    const d2 = new Date('2026-11-21T18:40:00Z'); // 00:10 IST, 22 Nov
    await countSmsSent(d1); await countSmsSent(d1);
    expect(await smsCapReached(d1)).toBe(true);
    expect(await smsCapReached(d2)).toBe(false);
  });
});

describe('send-otp at the cap', () => {
  test('5 real sends go out; the 6th (another number) is refused 503 SMS_DAILY_CAP and sends nothing', async () => {
    for (let i = 1; i <= 5; i++) expect((await send(`98765100${String(i).padStart(2, '0')}`)).statusCode).toBe(200);
    expect(get).toHaveBeenCalledTimes(5);
    const r = await send('9876510006');
    expect(r.statusCode).toBe(503);
    expect(r.body).toEqual({
      error: 'We can’t send sign-in codes just now. Please try again later, or sign in with your email and password.',
      code: 'SMS_DAILY_CAP',
    });
    expect(get).toHaveBeenCalledTimes(5);
    expect(smsToday()).toBe(5);
  });
  test('a failed send is not counted', async () => {
    mockSms.ok = false;
    const r = await send('9876510011');
    expect(r.statusCode).toBe(503);
    expect(r.body.code).toBe('OTP_SEND_FAILED');
    expect(smsToday()).toBe(0);
  });
  test('a test-number code sends no SMS and is not counted, even at the cap', async () => {
    process.env.OTP_TEST_NUMBERS = '9876510021'; process.env.OTP_TEST_CODE = '246810';
    process.env.SMS_DAILY_CAP = '1';
    await send('9876510022'); // the one real SMS of the day
    const r = await send('9876510021');
    expect(r.statusCode).toBe(200);
    expect(get).toHaveBeenCalledTimes(1);
    expect(smsToday()).toBe(1);
  });
  test('the per-number limit still applies, and now its own words show (F016): 6th code to one number in an hour', async () => {
    process.env.SMS_DAILY_CAP = '100';
    const rs = [];
    for (let i = 0; i < 6; i++) rs.push(await send('9876510031'));
    expect(rs.slice(0, 5).map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(rs[5].statusCode).toBe(429);
    expect(rs[5].body).toEqual({ error: 'Too many codes sent to this number. Try again in an hour.', code: 'OTP_SEND_LIMIT' });
  });
});

describe('the per-connection send limit', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
  test('50 an hour (was 5), on the send-otp limiter', () => {
    expect(idx).toMatch(/export const SEND_OTP_PER_IP_HOUR = 50;/);
    const lim = idx.slice(idx.indexOf('const sendOtpLimiter = rateLimit('), idx.indexOf("handler: limitReply('otp')"));
    expect(lim).toMatch(/windowMs: 60 \* 60 \* 1000,/);
    expect(lim).toMatch(/max: SEND_OTP_PER_IP_HOUR,/);
  });
  test('its reply: the clearer words, with the wait', async () => {
    const { limitReply } = await import('../utils/limitReply');
    const r: any = { setHeader: jest.fn() };
    r.status = jest.fn(() => r); r.json = jest.fn((b: unknown) => { r.body = b; return r; });
    limitReply('otp')({ rateLimit: { resetTime: new Date(Date.now() + 42 * 60e3) } } as any, r, jest.fn(), { statusCode: 429 } as any);
    expect(r.body.code).toBe('OTP_IP_LIMIT');
    expect(r.body.error).toMatch(/^Many sign-in codes were asked for on this Wi-Fi or network in the last hour\. Try again in 4[12] minutes\. Or switch to mobile data, or sign in with your email and password\.$/);
  });
});
