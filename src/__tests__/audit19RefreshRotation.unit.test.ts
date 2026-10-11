/**
 * Audit #19 (11 Oct 2026): refresh tokens were stored in plain text and never
 * changed. Now: only a hash is stored and looked up; an app that says
 * "rotate-refresh" gets a new token on each refresh; an old token presented
 * again after the grace window ends the whole sign-in; older apps keep working.
 */
import { fakeDb } from './helpers/fakeSupabase';
import { generateRefreshToken } from '../utils/jwt';
import { hashRefreshToken, ROTATION_GRACE_MS } from '../utils/refreshTokenStore';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sessionDeny', () => ({ denySessions: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { refresh } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { insertRefreshToken } from '../utils/sessionDevice';

const U = 'user-19';
const call = async (token: string, rotate = true) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await refresh({ body: { refreshToken: token }, headers: rotate ? { 'x-client-features': 'events,pairs,rotate-refresh' } : {} } as any, r);
  return r;
};

describe('audit #19: refresh tokens hashed and rotated', () => {
  let t0 = '';
  beforeEach(async () => {
    db = fakeDb({ users: [{ id: U, deleted_at: null, suspended_at: null, is_suspended: false, banned_at: null }], refresh_tokens: [] });
    t0 = generateRefreshToken(U);
    await insertRefreshToken(U, t0, { headers: {} } as any);
  });

  it('a new sign-in stores only the hash', () => {
    const row = db.t('refresh_tokens')[0];
    expect(row.token).toBeNull();
    expect(row.token_hash).toBe(hashRefreshToken(t0));
  });

  it('rotates for an app that asks, and the new token works', async () => {
    const r1 = await call(t0);
    expect(r1.statusCode).toBe(200);
    expect(r1.body.refreshToken).toBeTruthy();
    expect(r1.body.refreshToken).not.toBe(t0);
    expect((await call(r1.body.refreshToken)).statusCode).toBe(200);
  });

  it('the replaced token, presented after the grace window, ends the sign-in', async () => {
    const r1 = await call(t0);
    db.t('refresh_tokens')[0].rotated_at = new Date(Date.now() - ROTATION_GRACE_MS - 1000).toISOString();
    const stolen = await call(t0);
    expect(stolen.statusCode).toBe(401);
    expect(stolen.body.code).toBe('REFRESH_REUSED');
    expect(db.t('refresh_tokens')[0].revoked).toBe(true);
    expect((await call(r1.body.refreshToken)).statusCode).toBe(401); // the whole sign-in is over
  });

  it('within the grace window (a lost response) the old token is answered again', async () => {
    await call(t0);
    const retry = await call(t0);
    expect(retry.statusCode).toBe(200);
    expect(retry.body.refreshToken).toBeTruthy();
  });

  it('an older app (no rotate-refresh) keeps its token and stays signed in', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await call(t0, false);
      expect(r.statusCode).toBe(200);
      expect(r.body.refreshToken).toBeUndefined();
    }
  });
});
