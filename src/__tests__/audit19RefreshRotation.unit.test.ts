/**
 * Audit #19 (11 Oct 2026): refresh tokens were stored in plain text and never
 * changed. Now: only a hash is stored and looked up; an app that says
 * "rotate-refresh" gets a new token on each refresh; older apps keep working.
 * 2.16.0 release pass (12 Oct): the token the latest rotation replaced is a lost
 * reply, answered at any time (it ended the whole sign-in after 60 s, and a
 * dropped reply plus a minute offline signed people out); older tokens are
 * refused; a database hiccup answers 503 (try again), never 401 (signed out).
 */
import { fakeDb } from './helpers/fakeSupabase';
import { generateRefreshToken } from '../utils/jwt';
import { hashRefreshToken } from '../utils/refreshTokenStore';

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

  it('a lost reply: the replaced token, even hours later, gets a new one and the sign-in goes on', async () => {
    await call(t0); // rotated, but the phone never got the reply
    db.t('refresh_tokens')[0].rotated_at = new Date(Date.now() - 8 * 3600_000).toISOString(); // a night offline
    const again = await call(t0);
    expect(again.statusCode).toBe(200);
    expect(again.body.refreshToken).toBeTruthy();
    expect(db.t('refresh_tokens')[0].revoked).toBeFalsy();
    const next = await call(again.body.refreshToken);
    expect(next.statusCode).toBe(200);
    expect(next.body.refreshToken).toBeTruthy();
  });

  it('a token two renewals old is refused (and the sign-in is not ended)', async () => {
    const r1 = await call(t0);
    const r2 = await call(r1.body.refreshToken);
    const old = await call(t0);
    expect(old.statusCode).toBe(401);
    expect(db.t('refresh_tokens')[0].revoked).toBeFalsy();
    expect((await call(r2.body.refreshToken)).statusCode).toBe(200);
  });

  it('a database hiccup answers 503 (try again), not 401 (signed out)', async () => {
    const real = db.client.from.bind(db.client);
    const spy = jest.spyOn(db.client, 'from').mockImplementation(((t: string) => {
      if (t !== 'refresh_tokens') return real(t);
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { message: 'timeout', code: '57014' } }) };
      return q;
    }) as any);
    const r = await call(t0);
    spy.mockRestore();
    expect(r.statusCode).toBe(503);
    expect(r.body.code).toBe('REFRESH_UNAVAILABLE');
    expect((await call(t0)).statusCode).toBe(200); // and once it answers, the same token works
  });

  it('a token that is not ours is still 401', async () => {
    expect((await call('not-a-jwt')).statusCode).toBe(401);
  });

  it('an older app (no rotate-refresh) keeps its token and stays signed in', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await call(t0, false);
      expect(r.statusCode).toBe(200);
      expect(r.body.refreshToken).toBeUndefined();
    }
  });
});
