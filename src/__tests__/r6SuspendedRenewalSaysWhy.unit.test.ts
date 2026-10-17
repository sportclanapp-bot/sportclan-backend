/**
 * Round 6 · N-R6-3: an admin's suspension revokes every sign-in first, so the phone's
 * next renewal was refused only as "revoked" (401) and the app told the suspended person
 * their sign-in had expired. The renewal now says the account is suspended (or deleted).
 */
import { fakeDb } from './helpers/fakeSupabase';
import { generateRefreshToken } from '../utils/jwt';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sessionDeny', () => ({ denySessions: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { refresh } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { insertRefreshToken } from '../utils/sessionDevice';

const U = 'user-r6-susp';
const call = async (token: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await refresh({ body: { refreshToken: token }, headers: {} } as any, r);
  return r;
};
let t0 = '';
beforeEach(async () => {
  db = fakeDb({ users: [{ id: U, deleted_at: null, suspended_at: null }], refresh_tokens: [], refresh_token_orphans: [] });
  t0 = generateRefreshToken(U);
  await insertRefreshToken(U, t0, { headers: {} } as any);
});
const revokeAll = () => { for (const r of db.t('refresh_tokens')) r.revoked = true; };

test('suspended, sign-ins revoked (what the admin route does): 403 with the suspended words', async () => {
  db.t('users')[0].suspended_at = '2026-10-17T10:00:00Z'; revokeAll();
  const r = await call(t0);
  expect(r.statusCode).toBe(403);
  expect(r.body.error).toMatch(/suspended/i);
});
test('deleted, sign-ins removed: 403 ACCOUNT_DELETED', async () => {
  db.t('users')[0].deleted_at = '2026-10-17T10:00:00Z'; db.t('refresh_tokens').length = 0;
  const r = await call(t0);
  expect(r.statusCode).toBe(403);
  expect(r.body.code).toBe('ACCOUNT_DELETED');
});
test('an active account with a revoked sign-in is still a plain 401 revoked', async () => {
  revokeAll();
  const r = await call(t0);
  expect(r.statusCode).toBe(401);
  expect(r.body.error).toBe('Refresh token revoked');
});
