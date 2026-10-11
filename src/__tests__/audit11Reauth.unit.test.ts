/**
 * Audit #11 (11 Oct 2026): changing the phone number or deleting the account
 * needed only an access token. Both now need the current password, or a code
 * texted to the account's current number (purpose 'reauth').
 */
import bcrypt from 'bcryptjs';
import { fakeDb } from './helpers/fakeSupabase';

const store = new Map<string, { code: string; purpose: string }>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async (p: string, code: string, purpose: string) => { store.set(p, { code, purpose }); }),
  getOtp: jest.fn(async (p: string) => store.get(p) ?? null),
  deleteOtp: jest.fn(async (p: string) => { store.delete(p); }),
  bumpCounter: jest.fn(async () => 1), readCounter: jest.fn(async () => 0), clearCounter: jest.fn(async () => undefined),
}));
let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sessionRevocation', () => ({ revokeSessionsNow: jest.fn(async () => Date.now()) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { changePhone } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { deleteAccount } from '../controllers/account.controller';

const ME = 'user-me';
const call = async (fn: any, body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: ME, body, ip: '203.0.113.5', headers: {} } as any, r);
  return r;
};

describe('audit #11: a stolen token can’t move or delete the account', () => {
  beforeEach(async () => {
    store.clear();
    db = fakeDb({ users: [{ id: ME, phone: '+919000000050', password_hash: await bcrypt.hash('right-pass-1', 4), deleted_at: null, name: 'Me' }], refresh_tokens: [], push_tokens: [] });
    store.set('+919000000077', { code: '424242', purpose: 'change_phone' }); // the new number's code
  });

  it('change phone with only a token → 403 REAUTH_REQUIRED (not 401: that signs the app out), number unchanged', async () => {
    const r = await call(changePhone, { newPhone: '9000000077', code: '424242' });
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('REAUTH_REQUIRED');
    expect(db.t('users')[0].phone).toBe('+919000000050');
  });
  it('a wrong password is refused', async () => {
    const r = await call(changePhone, { newPhone: '9000000077', code: '424242', current_password: 'nope' });
    expect(r.body.code).toBe('REAUTH_WRONG');
    expect(db.t('users')[0].phone).toBe('+919000000050');
  });
  it('the right password lets the owner change it', async () => {
    const r = await call(changePhone, { newPhone: '9000000077', code: '424242', current_password: 'right-pass-1' });
    expect(r.statusCode).toBe(200);
    expect(db.t('users')[0].phone).toBe('+919000000077');
  });
  it('a reauth code texted to the CURRENT number works too', async () => {
    store.set('+919000000050', { code: '135790', purpose: 'reauth' });
    const r = await call(changePhone, { newPhone: '9000000077', code: '424242', reauth_code: '135790' });
    expect(r.statusCode).toBe(200);
  });
  it('delete account with only "DELETE" → 403, account kept', async () => {
    const r = await call(deleteAccount, { confirmation: 'DELETE' });
    expect(r.statusCode).toBe(403);
    expect(db.t('users')[0].deleted_at).toBeNull();
  });
  it('delete account with the password goes ahead', async () => {
    const r = await call(deleteAccount, { confirmation: 'DELETE', current_password: 'right-pass-1' });
    expect(r.statusCode).not.toBe(403);
    expect(db.t('users')[0].deleted_at).not.toBeNull();
  });
});
