/**
 * N-R7-3 (Step 2, X2-022): after 20 wrong guesses from several places the code is
 * deleted (right) — but the number-wide count stayed for 15 minutes, so the owner's
 * NEW code was refused too ("Too many wrong codes") and anyone with four connections
 * could keep a number locked out. A brand-new code now starts a fresh number-wide
 * count; a still-valid code that is only re-sent does not, so asking for codes can't
 * wipe the count.
 */
const store = new Map<string, { code: string; purpose: string }>();
const mockCtr = new Map<string, number>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async (phone: string, code: string, purpose: string) => { store.set(phone, { code, purpose }); return 'memory'; }),
  getOtp: jest.fn(async (phone: string) => store.get(phone) ?? null),
  deleteOtp: jest.fn(async (phone: string) => { store.delete(phone); }),
  bumpCounter: jest.fn(async (k: string) => { const n = (mockCtr.get(k) ?? 0) + 1; mockCtr.set(k, n); return n; }),
  readCounter: jest.fn(async (k: string) => mockCtr.get(k) ?? 0),
  clearCounter: jest.fn(async (k: string) => { mockCtr.delete(k); }),
}));
const sms: string[] = [];
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async (url: string) => { sms.push(url); return { data: { Status: 'Success', Details: 'x' } }; }) } }));
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'in', 'is', 'eq', 'not', 'limit', 'order', 'maybeSingle', 'update']) chain[m] = jest.fn(() => chain);
  chain.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
  return { supabase: chain };
});

// eslint-disable-next-line import/first
import { sendOtp, verifyOtp } from '../controllers/auth.controller';

const PHONE = '9000000042';
const P = '+919000000042';
const call = async (fn: any, body: object, ip: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ body, ip, headers: {} } as any, r);
  return r;
};

describe('N-R7-3: 20 wrong guesses delete the code, and a new code then works', () => {
  beforeEach(() => { store.clear(); mockCtr.clear(); sms.length = 0; process.env.TWOFACTOR_API_KEY = 'test'; });

  it('owner gets in with a new code after the code was guessed away', async () => {
    await call(sendOtp, { phone: PHONE, purpose: 'login' }, '203.0.113.20');
    const first = store.get(P)!.code;
    for (let i = 0; i < 20; i++) await call(verifyOtp, { phone: PHONE, code: String(100000 + i) }, `192.0.2.${10 + (i % 4)}`);
    expect(store.get(P)).toBeUndefined(); // gone after the 20th
    const locked = await call(verifyOtp, { phone: PHONE, code: first }, '203.0.113.20');
    expect(locked.body.code).toBe('OTP_LOCKED'); // the old code is no good: send a new one
    expect((await call(sendOtp, { phone: PHONE, purpose: 'login' }, '203.0.113.20')).statusCode).toBe(200);
    const fresh = store.get(P)!.code;
    const v = await call(verifyOtp, { phone: PHONE, code: fresh }, '203.0.113.20');
    expect(v.body).toEqual({ success: true, verified: true });
  });

  it('re-sending a still-valid code does not reset the number-wide count', async () => {
    await call(sendOtp, { phone: PHONE, purpose: 'login' }, '203.0.113.20');
    for (let i = 0; i < 16; i++) await call(verifyOtp, { phone: PHONE, code: String(200000 + i) }, `192.0.2.${10 + (i % 4)}`);
    await call(sendOtp, { phone: PHONE, purpose: 'login' }, '192.0.2.50'); // same code sent again
    expect(store.get(P)).toBeDefined();
    for (let i = 0; i < 4; i++) await call(verifyOtp, { phone: PHONE, code: String(300000 + i) }, '192.0.2.50');
    expect(store.get(P)).toBeUndefined(); // 20 in all → gone
  });
});
