/**
 * N-R7-65 (Step 2, SCR-A-125 on the phone): the sign-in answers carried no sport_ids, so right after
 * signing in a badminton-only player's Search › 'players near you' fell back to the CRICKET list
 * (F044's own-sport rule read an empty list) until the app next reloaded the profile. They now carry
 * sport_ids, as GET /users/me does (its order: the person's chosen sports in display order).
 */
import bcrypt from 'bcryptjs';
import { fakeDb } from './helpers/fakeSupabase';

const ctr = new Map<string, number>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(), getOtp: jest.fn(async () => null), deleteOtp: jest.fn(),
  bumpCounter: jest.fn(async (k: string) => { const n = (ctr.get(k) ?? 0) + 1; ctr.set(k, n); return n; }),
  readCounter: jest.fn(async (k: string) => ctr.get(k) ?? 0),
  clearCounter: jest.fn(async (k: string) => { ctr.delete(k); }),
}));
let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sessionDevice', () => ({ ...jest.requireActual('../utils/sessionDevice'), insertRefreshToken: jest.fn(async () => 'sid-1') }));

// eslint-disable-next-line import/first
import { login } from '../controllers/auth.controller';

const call = async (password: string, ip: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await login({ body: { email: 'me@example.com', password }, ip, headers: {} } as any, r);
  return r;
};

beforeEach(async () => {
  ctr.clear();
  db = fakeDb({
    users: [{ id: 'u12', email: 'me@example.com', phone: '+919000000012', account_type: 'umpire', password_hash: await bcrypt.hash('right-one-1', 4), deleted_at: null, suspended_at: null, is_suspended: false }],
    user_account_types: [{ user_id: 'u12', account_type: 'umpire' }],
    user_sports: [{ user_id: 'u12', sport_id: 's-bad', sport: { display_order: 2 } }],
  });
});
it('password sign-in returns the person\'s sports, as /users/me does', async () => {
  const r = await call('right-one-1', '203.0.113.9');
  expect(r.statusCode).toBe(200);
  expect(r.body.user.sport_ids).toEqual(['s-bad']);
});
