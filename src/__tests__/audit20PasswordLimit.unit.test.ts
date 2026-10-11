/**
 * Audit #20 (11 Oct 2026): password guessing was limited only per IP. Now per
 * account and requester, plus a per-account ceiling from anywhere — and the
 * owner can still sign in from their own phone (or by code).
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
import { login, PASSWORD_FAILS_PER_REQUESTER, PASSWORD_FAILS_PER_ACCOUNT } from '../controllers/auth.controller';

const call = async (password: string, ip: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await login({ body: { email: 'me@example.com', password }, ip, headers: {} } as any, r);
  return r;
};

describe('audit #20: password guessing is limited per account', () => {
  beforeEach(async () => {
    ctr.clear();
    db = fakeDb({ users: [{ id: 'u20', email: 'me@example.com', phone: '+919000000020', password_hash: await bcrypt.hash('right-one-1', 4), deleted_at: null, suspended_at: null, is_suspended: false }] });
  });
  it(`${PASSWORD_FAILS_PER_REQUESTER} wrong from one place stops that place, even with the right password`, async () => {
    for (let i = 0; i < PASSWORD_FAILS_PER_REQUESTER; i++) expect((await call('nope', '198.51.100.1')).statusCode).toBe(401);
    expect((await call('right-one-1', '198.51.100.1')).body.code).toBe('PASSWORD_LOCKED');
    expect((await call('right-one-1', '203.0.113.9')).statusCode).toBe(200); // the owner, elsewhere
  });
  it(`${PASSWORD_FAILS_PER_ACCOUNT} wrong from many places pauses password sign-in`, async () => {
    for (let i = 0; i < PASSWORD_FAILS_PER_ACCOUNT; i++) await call('nope', `10.0.${Math.floor(i / 9)}.${i % 9}`);
    expect((await call('nope', '192.0.2.77')).body.code).toBe('PASSWORD_LOCKED');
  });
});
