/**
 * F027 (launch test plan, Round 1) · a sign-in key the phone has already replaced
 * kept working for ever, and whoever used a copy of it signed the real owner out.
 *
 * Dipak's rule stays (12 Oct): the key the latest renewal replaced is forgiven at
 * any time — that is a lost reply, and the new key never reached anyone. So the
 * key it pushes aside is remembered; if THAT key is ever shown later, a second
 * holder exists, and the session ends for both. A lost reply never trips this,
 * because its new key was never delivered.
 */
import { fakeDb } from './helpers/fakeSupabase';
import { generateRefreshToken } from '../utils/jwt';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const denied: string[][] = [];
jest.mock('../utils/sessionDeny', () => ({ denySessions: jest.fn(async (ids: string[]) => { denied.push(ids); }) }));

// eslint-disable-next-line import/first
import { refresh } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { insertRefreshToken } from '../utils/sessionDevice';

const U = 'user-f027';
const call = async (token: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await refresh({ body: { refreshToken: token }, headers: { 'x-client-features': 'events,pairs,rotate-refresh' } } as any, r);
  return r;
};

describe('F027 · a replaced key that comes back after the newer key was handed out', () => {
  let t0 = '';
  beforeEach(async () => {
    denied.length = 0;
    db = fakeDb({ users: [{ id: U, deleted_at: null, suspended_at: null, is_suspended: false, banned_at: null }], refresh_tokens: [], refresh_token_orphans: [] });
    t0 = generateRefreshToken(U);
    await insertRefreshToken(U, t0, { headers: {} } as any);
  });

  it('the proof run: a copy of T1 used after the owner got T2 → the owner showing T2 ends the session for both', async () => {
    const t1 = (await call(t0)).body.refreshToken;
    const t2 = (await call(t1)).body.refreshToken;          // the owner now holds T2
    const stolen = await call(t1);                          // someone shows the replaced T1
    expect(stolen.statusCode).toBe(200);                    // (it looks just like a lost reply)
    const owner = await call(t2);                           // the owner's T2 comes back
    expect(owner.statusCode).toBe(401);
    expect(owner.body.code).toBe('REFRESH_REUSED');
    expect(db.t('refresh_tokens')[0].revoked).toBe(true);
    expect(denied.flat()).toContain(db.t('refresh_tokens')[0].id);
    expect((await call(stolen.body.refreshToken)).statusCode).toBe(401); // and the copy's new key is dead too
    expect((await call(t1)).statusCode).toBe(401);                       // and T1 never works again
  });

  it('a lost reply twice in a row still keeps the sign-in (its new keys never reached anyone)', async () => {
    await call(t0);                  // reply lost
    await call(t0);                  // reply lost again
    const ok = await call(t0);
    expect(ok.statusCode).toBe(200);
    expect((await call(ok.body.refreshToken)).statusCode).toBe(200);
    expect(db.t('refresh_tokens')[0].revoked).toBeFalsy();
  });

  it('once the owner uses the newer key, the replaced one is refused (and the owner stays signed in)', async () => {
    const t1 = (await call(t0)).body.refreshToken;
    const t2 = (await call(t1)).body.refreshToken;
    const t3 = (await call(t2)).body.refreshToken;
    expect((await call(t1)).statusCode).toBe(401);
    expect(db.t('refresh_tokens')[0].revoked).toBeFalsy();
    expect((await call(t3)).statusCode).toBe(200);
  });
});
