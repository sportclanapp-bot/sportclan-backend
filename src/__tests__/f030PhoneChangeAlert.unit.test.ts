/**
 * F030 (launch test plan, Round 1) · a phone number change was announced only to the
 * phone that made it: the other phones were signed out (and their push tokens removed)
 * first, so a real owner whose account was taken never heard. The alert now goes out
 * before the sign-out, to every phone of the account, and says which numbers.
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
const seen: Array<{ body: string; tokensAtSend: string[] }> = [];
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(async (a: { body: string }) => { seen.push({ body: a.body, tokensAtSend: db.t('push_tokens').map((t: any) => t.token) }); }),
  notifyUsers: jest.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import { changePhone } from '../controllers/auth.controller';

const ME = 'user-f030';
it('the alert reaches every phone (sent before they are signed out) and names both numbers', async () => {
  seen.length = 0;
  db = fakeDb({
    users: [{ id: ME, phone: '+919000000050', password_hash: await bcrypt.hash('right-pass-1', 4), deleted_at: null, name: 'Me' }],
    refresh_tokens: [], push_tokens: [{ user_id: ME, token: 'tok-owner-phone' }, { user_id: ME, token: 'tok-this-phone' }],
  });
  store.set('+919000000077', { code: '424242', purpose: 'change_phone' });
  const r: any = { statusCode: 200 }; r.status = jest.fn((c: number) => { r.statusCode = c; return r; }); r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await changePhone({ userId: ME, body: { newPhone: '9000000077', code: '424242', current_password: 'right-pass-1' }, ip: '203.0.113.5', headers: { 'x-push-token': 'tok-this-phone', 'user-agent': 'okhttp' } } as any, r);
  expect(r.statusCode).toBe(200);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.tokensAtSend).toContain('tok-owner-phone');     // the other phone still gets it
  expect(seen[0]!.body).toContain('•••••• 0050');                 // the old number
  expect(seen[0]!.body).toContain('•••••• 0077');                 // the new one
  expect(db.t('push_tokens').map((t: any) => t.token)).toEqual(['tok-this-phone']); // and the sign-out still happens after
});
