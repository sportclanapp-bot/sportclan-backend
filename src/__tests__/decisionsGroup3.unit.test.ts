/**
 * Dipak's decisions, group 3 (29 Sep 2026) — the backend parts.
 *  12  password sign-in by mobile: a held (deleted) number gets the deleted-
 *      account refusal, not "OTP login only"; past the hold it's no account;
 *  14  an admin broadcast sends a real push, one token read + one Expo send
 *      per chunk of recipients, alongside the in-app rows.
 * Supabase is a recording chain; each awaited query takes the next queued result.
 */
type Result = { data?: unknown; error?: unknown; count?: number | null };
let results: Result[] = [];
let queries: string[][] = [];
jest.mock('../utils/supabase', () => {
  const make = () => {
    const log: string[] = [];
    queries.push(log);
    const q: any = {};
    for (const m of ['select', 'insert', 'update', 'eq', 'neq', 'is', 'in', 'gte', 'order', 'range', 'or', 'not', 'limit', 'ilike']) {
      q[m] = jest.fn((...a: unknown[]) => { log.push(`${m}:${JSON.stringify(a)}`); return q; });
    }
    const next = () => results.shift() ?? { data: null, error: null, count: 0 };
    q.maybeSingle = jest.fn(async () => next());
    q.single = jest.fn(async () => next());
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, bad);
    return q;
  };
  return { supabase: { from: jest.fn((t: string) => { const q = make(); queries[queries.length - 1].push(`from:${t}`); return q; }) } };
});
jest.mock('../utils/expoPush', () => ({ sendPushToTokens: jest.fn(async (t: string[]) => t.length) }));
jest.mock('../utils/tournamentAuth', () => ({ logAdminAction: jest.fn(async () => undefined) }));
jest.mock('bcryptjs', () => ({ __esModule: true, default: { compare: jest.fn(async () => false), hash: jest.fn(async () => 'h') } }));

// eslint-disable-next-line import/first
import { broadcastAnnouncement, pushBroadcastChunk } from '../controllers/admin.controller';
// eslint-disable-next-line import/first
import { login } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { sendPushToTokens } from '../utils/expoPush';

const push = sendPushToTokens as jest.Mock;
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: 'admin-1', params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const DAY = 86400000;

beforeEach(() => { results = []; queries = []; push.mockClear(); });

describe('14 · broadcast sends a push', () => {
  test('each chunk: tokens read for its users, one send with the announcement', async () => {
    results = [{ data: [{ token: 'ExponentPushToken[a]' }, { token: 'ExponentPushToken[b]' }] }];
    const n = await pushBroadcastChunk(['u1', 'u2'], 'Hi', 'There');
    expect(n).toBe(2);
    expect(push).toHaveBeenCalledWith(['ExponentPushToken[a]', 'ExponentPushToken[b]'],
      { title: 'Hi', body: 'There', data: { type: 'system', broadcast: 'true' } });
    expect(queries[0].join(' ')).toMatch(/from:push_tokens.*in:\["user_id",\["u1","u2"\]\]/);
  });
  test('no devices → no send; a failed read never throws', async () => {
    results = [{ data: [] }];
    expect(await pushBroadcastChunk(['u1'], 'Hi', 'There')).toBe(0);
    expect(push).not.toHaveBeenCalled();
    push.mockRejectedValueOnce(new Error('expo down'));
    results = [{ data: [{ token: 'ExponentPushToken[a]' }] }];
    expect(await pushBroadcastChunk(['u1'], 'Hi', 'There')).toBe(0);
  });
  test('a confirmed broadcast writes the in-app rows, then pushes that chunk', async () => {
    results = [
      { data: [{ id: 'u1' }, { id: 'u2' }] },          // recipients page
      { data: null, error: null },                        // notifications insert
      { data: [{ token: 'ExponentPushToken[a]' }] },     // push_tokens for the chunk
    ];
    const r = await call(broadcastAnnouncement, { body: { title: 'Hi', body: 'There', confirm: true } });
    expect(r.body).toEqual({ ok: true, recipients: 2, queued: true });
    await flush();
    const q = queries.map((x) => x.join(' '));
    expect(q.findIndex((s) => s.includes('from:notifications'))).toBeLessThan(q.findIndex((s) => s.includes('from:push_tokens')));
    expect(push).toHaveBeenCalledTimes(1);
  });
  test('the dry-run still only counts — no rows, no push', async () => {
    results = [{ data: [{ id: 'u1' }, { id: 'u2' }] }];
    const r = await call(broadcastAnnouncement, { body: { title: 'Hi', body: 'There' } });
    expect(r.statusCode).toBe(400);
    expect(r.body.recipients).toBe(2);
    await flush();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('12 · password sign-in by mobile', () => {
  const row = (over: object) => ({ id: 'u1', phone: '+919000000001', password_hash: null, deleted_at: null, ...over });
  test('a deleted account still inside its 30-day hold → the deleted-account refusal with the date', async () => {
    const deletedAt = new Date(Date.now() - 5 * DAY).toISOString();
    results = [{ data: row({ deleted_at: deletedAt }) }];
    const r = await call(login, { body: { phone: '9000000001', password: 'whatever1' } });
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('ACCOUNT_DELETED');
    expect(r.body.available_from).toBe(new Date(Date.parse(deletedAt) + 30 * DAY).toISOString());
  });
  test('past the hold it is no account', async () => {
    results = [{ data: row({ deleted_at: new Date(Date.now() - 31 * DAY).toISOString() }) }];
    const r = await call(login, { body: { phone: '9000000001', password: 'whatever1' } });
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: 'Invalid credentials' });
  });
  test('a live phone account is looked up by every stored form, and a wrong password is 401', async () => {
    results = [{ data: row({ password_hash: 'h' }) }];
    const r = await call(login, { body: { phone: '+91 90000 00001', password: 'wrong-one' } });
    expect(r.statusCode).toBe(401);
    expect(queries[0].join(' ')).toMatch(/in:\["phone",\[.*"\+919000000001".*\]\]/);
  });
  test('the email path is unchanged (no early deleted check before the password)', async () => {
    results = [{ data: row({ email: 'a@b.co', deleted_at: new Date().toISOString() }) }];
    const r = await call(login, { body: { email: 'a@b.co', password: 'whatever1' } });
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: 'Account uses OTP login only' });
  });
});
