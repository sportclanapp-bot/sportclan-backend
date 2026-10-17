/**
 * N-R6-12 (Round 6): the sign-in answers carried only the legacy primary account-type column, so an
 * umpire who had just signed in had no Officiate / Offer to officiate until the app reloaded the
 * profile (seen on the phone, 17 Oct). They now carry account_types, as GET /users/me does.
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
    user_account_types: [{ user_id: 'u12', account_type: 'umpire' }, { user_id: 'u12', account_type: 'coach' }],
  });
});
it('password sign-in returns every account type', async () => {
  const r = await call('right-one-1', '203.0.113.9');
  expect(r.statusCode).toBe(200);
  expect([...r.body.user.account_types].sort()).toEqual(['coach', 'umpire']);
  expect(r.body.user.password_hash).toBeUndefined();
});
it('an account with no rows falls back to its valid primary type', async () => {
  db.t('user_account_types').length = 0;
  expect((await call('right-one-1', '203.0.113.9')).body.user.account_types).toEqual(['umpire']);
});
