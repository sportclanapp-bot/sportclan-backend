/**
 * N-RWG4-12 (launch test plan, Round 1) · a new person had 5 minutes from the text
 * message to finish all five sign-up steps: the code checked on the code screen was
 * checked again by Create account, and by then it had expired ('No OTP requested or OTP
 * expired') and everything typed was lost. Once the code is proven for a number with no
 * account, it stays good for sign-up for an hour.
 */
import { fakeDb } from './helpers/fakeSupabase';

const store = new Map<string, { code: string; purpose: string; ttl: number }>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async (p: string, code: string, purpose: string, ttl: number) => { store.set(p, { code, purpose, ttl }); }),
  getOtp: jest.fn(async (p: string) => store.get(p) ?? null),
  deleteOtp: jest.fn(async (p: string) => { store.delete(p); }),
  bumpCounter: jest.fn(async () => 1), readCounter: jest.fn(async () => 0), clearCounter: jest.fn(async () => undefined),
}));
let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));

// eslint-disable-next-line import/first
import { otpLogin } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { verifiedMarker } from '../utils/otpCheck';

const call = async (body: object) => {
  const r: any = { statusCode: 200 }; r.status = jest.fn((c: number) => { r.statusCode = c; return r; }); r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await otpLogin({ body, ip: '203.0.113.9', headers: {} } as any, r);
  return r;
};

it('a proven code for a new number is kept for sign-up for an hour (verified, not the plain code)', async () => {
  db = fakeDb({ users: [] });
  store.set('+919000000088', { code: '246810', purpose: 'login', ttl: 300 });
  const r = await call({ phone: '9000000088', code: '246810' });
  expect(r.statusCode).toBe(404);
  expect(r.body.needsRegistration).toBe(true);
  const kept = store.get('+919000000088')!;
  expect(kept.code).toBe(verifiedMarker('246810'));
  expect(kept.ttl).toBeGreaterThanOrEqual(3600);
  expect(['login', 'register']).toContain(kept.purpose);
});

it('a wrong code for a new number changes nothing', async () => {
  db = fakeDb({ users: [] });
  store.set('+919000000089', { code: '246810', purpose: 'login', ttl: 300 });
  const r = await call({ phone: '9000000089', code: '111111' });
  expect(r.statusCode).toBe(400);
  expect(store.get('+919000000089')!.ttl).toBe(300);
});
