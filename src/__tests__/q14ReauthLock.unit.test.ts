/**
 * Q14 (Dipak, 21 Nov 2026, N-R3A-1) · "Confirm it's you" (delete account, change phone) locks
 * for 15 minutes after 10 wrong passwords, like sign-in. Before: 26 wrong passwords → 26 × 403
 * REAUTH_WRONG, never a lock, so a stolen token could guess the password here.
 */
import bcrypt from 'bcryptjs';
import { fakeDb } from './helpers/fakeSupabase';

const store = new Map<string, { code: string; purpose: string }>();
const mockCtr = new Map<string, { n: number; ttl: number }>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async (p: string, code: string, purpose: string) => { store.set(p, { code, purpose }); }),
  getOtp: jest.fn(async (p: string) => store.get(p) ?? null),
  deleteOtp: jest.fn(async (p: string) => { store.delete(p); }),
  bumpCounter: jest.fn(async (k: string, ttl: number) => { const c = mockCtr.get(k); const n = (c?.n ?? 0) + 1; mockCtr.set(k, { n, ttl: c?.ttl ?? ttl }); return n; }),
  readCounter: jest.fn(async (k: string) => mockCtr.get(k)?.n ?? 0),
  clearCounter: jest.fn(async (k: string) => { mockCtr.delete(k); }),
}));
let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sessionRevocation', () => ({ revokeSessionsNow: jest.fn(async () => Date.now()) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { changePhone } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { deleteAccount } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import { REAUTH_PASSWORD_FAILS, REAUTH_LOCK_SECONDS } from '../utils/reauth';

const ME = 'user-me';
const call = async (fn: any, body: object, ip = '203.0.113.5') => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: ME, body, ip, headers: {} } as any, r);
  return r;
};
const del = (pw: string, ip?: string) => call(deleteAccount, { confirmation: 'DELETE', current_password: pw }, ip);

beforeEach(async () => {
  store.clear(); mockCtr.clear();
  db = fakeDb({ users: [{ id: ME, phone: '+919000000050', password_hash: await bcrypt.hash('right-pass-1', 4), deleted_at: null, name: 'Me' }], refresh_tokens: [], push_tokens: [] });
});

it('the same numbers as sign-in: 10 tries, 15 minutes', () => {
  expect(REAUTH_PASSWORD_FAILS).toBe(10);
  expect(REAUTH_LOCK_SECONDS).toBe(15 * 60);
});

it('10 wrong passwords are each "not right"; the 11th try is locked, even with the right password', async () => {
  for (let i = 0; i < 10; i++) {
    const r = await del(`wrong-guess-${i}`);
    expect([r.statusCode, r.body.code]).toEqual([403, 'REAUTH_WRONG']);
  }
  const locked = await del('right-pass-1');
  expect(locked.statusCode).toBe(429);
  expect(locked.body).toEqual({
    error: 'Too many wrong passwords. Try again in 15 minutes, or use a code we text to your current number.',
    code: 'REAUTH_LOCKED', methods: ['password', 'code'],
  });
  expect(db.t('users')[0].deleted_at).toBeNull();
  expect([...mockCtr.values()][0].ttl).toBe(15 * 60); // the lock ends 15 minutes after the first wrong try
});

it('the lock is per account (a new address does not help), and covers Change phone too', async () => {
  for (let i = 0; i < 10; i++) await del(`wrong-${i}`, `198.51.100.${i}`);
  const r = await call(changePhone, { newPhone: '9000000077', code: '424242', current_password: 'right-pass-1' }, '192.0.2.9');
  expect(r.statusCode).toBe(429);
  expect(r.body.code).toBe('REAUTH_LOCKED');
  expect(db.t('users')[0].phone).toBe('+919000000050');
});

it('while locked, the texted code still works (it has its own limit)', async () => {
  for (let i = 0; i < 10; i++) await del(`wrong-${i}`);
  store.set('+919000000050', { code: '135790', purpose: 'reauth' });
  const r = await call(deleteAccount, { confirmation: 'DELETE', reauth_code: '135790' });
  expect(r.statusCode).toBe(200);
});

it('a right password clears the count', async () => {
  for (let i = 0; i < 9; i++) await del(`wrong-${i}`);
  store.set('+919000000077', { code: '424242', purpose: 'change_phone' });
  expect((await call(changePhone, { newPhone: '9000000077', code: '424242', current_password: 'right-pass-1' })).statusCode).toBe(200);
  expect(mockCtr.size).toBe(0);
});

it('an account with no texted-code way is told only to wait', async () => {
  db.t('users')[0].phone = '+0email-123';
  for (let i = 0; i < 10; i++) await del(`wrong-${i}`);
  const r = await del('wrong-x');
  expect(r.body).toEqual({ error: 'Too many wrong passwords. Try again in 15 minutes.', code: 'REAUTH_LOCKED', methods: ['password'] });
});
