/**
 * Audit #10 (11 Oct 2026): anyone could lock a phone number out of OTP sign-in
 * for a day — send 10 codes to it (the per-number daily limit), then type 5
 * wrong codes (which deleted the code). Now the send limits and the wrong-code
 * lock are per number AND requester, a still-valid code is re-sent rather than
 * replaced, and only 20 wrong guesses from anywhere delete a code.
 * No SMS can be sent from here: axios is a stand-in.
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

describe('audit #10: one person can’t lock another’s number out of OTP', () => {
  beforeEach(() => { store.clear(); mockCtr.clear(); sms.length = 0; process.env.TWOFACTOR_API_KEY = 'test'; });

  it('after an attacker’s 10 sends and 5 wrong guesses, the owner still gets a code and signs in', async () => {
    const ATT = '198.51.100.9'; const OWNER = '203.0.113.20';
    for (let i = 0; i < 10; i++) await call(sendOtp, { phone: PHONE, purpose: 'login' }, ATT);
    expect((await call(sendOtp, { phone: PHONE, purpose: 'login' }, ATT)).statusCode).toBe(429); // the attacker is limited
    for (let i = 0; i < 5; i++) await call(verifyOtp, { phone: PHONE, code: '000000' }, ATT);
    expect((await call(verifyOtp, { phone: PHONE, code: '000000' }, ATT)).body.code).toBe('OTP_LOCKED'); // …and locked
    const s = await call(sendOtp, { phone: PHONE, purpose: 'login' }, OWNER);
    expect(s.statusCode).toBe(200);
    const code = store.get(P)!.code;
    const v = await call(verifyOtp, { phone: PHONE, code }, OWNER);
    expect(v.body).toEqual({ success: true, verified: true });
  });

  it('someone else asking for a code doesn’t make yours stop working', async () => {
    await call(sendOtp, { phone: PHONE, purpose: 'login' }, '203.0.113.20');
    const mine = store.get(P)!.code;
    await call(sendOtp, { phone: PHONE, purpose: 'login' }, '198.51.100.9');
    expect(store.get(P)!.code).toBe(mine);
  });
});
