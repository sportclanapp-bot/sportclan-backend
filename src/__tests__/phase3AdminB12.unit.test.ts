/**
 * Phase 3 · B12 (Admin & internal), 28 Sep 2026.
 *  F3  every admin account change, broadcast and dismiss goes to admin_actions;
 *  F6  a failed reports query is a 500, not "the queue is clear";
 *  F9  a deleted account can't be suspended or made admin;
 *  F10 dashboard counts leave out deleted accounts and posts;
 *  F12 otp-diagnostics shows a hash of the 2Factor key, none of the key;
 *  F13 broadcast pages past 1000, skips deleted/suspended, trims and caps;
 *  F14 the last-admin guard counts only admins who can still sign in.
 * Supabase is a recording chain: every call is logged per query, and each
 * awaited query takes the next queued result.
 */
type Result = { data?: unknown; error?: unknown; count?: number | null };
let results: Result[] = [];
let queries: string[][] = [];
jest.mock('../utils/supabase', () => {
  const make = () => {
    const log: string[] = [];
    queries.push(log);
    const q: any = {};
    for (const m of ['select', 'insert', 'update', 'eq', 'neq', 'is', 'in', 'gte', 'order', 'range', 'or', 'not', 'limit']) {
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
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { Status: 'Success', Details: '10' } })) } }));
jest.mock('../utils/tournamentAuth', () => ({ logAdminAction: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import {
  adminUpdateUser, broadcastAnnouncement, getReports, getStats, otpDiagnostics, resolveReport,
  BROADCAST_TITLE_MAX, BROADCAST_BODY_MAX,
} from '../controllers/admin.controller';
// eslint-disable-next-line import/first
import { logAdminAction } from '../utils/tournamentAuth';

const log = logAdminAction as jest.Mock;
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: 'admin-1', params: {}, query: {}, body: {}, ...req }, r); return r; };
const flat = () => queries.map((q) => q.join(' '));

beforeEach(() => { results = []; queries = []; log.mockClear(); });

describe('F3 · admin actions are logged', () => {
  const target = { data: { id: 'u2', is_admin: false, deleted_at: null } };
  test.each([
    [{ suspended: true }, 'suspend_user'],
    [{ suspended: false }, 'unsuspend_user'],
    [{ is_admin: true }, 'grant_admin'],
  ])('%j → %s', async (body, action) => {
    results = [target, { data: { id: 'u2' } }, { data: null }];
    const r = await call(adminUpdateUser, { params: { id: 'u2' }, body });
    expect(r.statusCode).toBe(200);
    expect(log).toHaveBeenCalledWith('admin-1', action, 'user', 'u2', null);
  });
  test('revoke_admin (with another live admin left)', async () => {
    results = [{ data: { id: 'u2', is_admin: true, deleted_at: null } }, { count: 2 }, { data: { id: 'u2' } }];
    const r = await call(adminUpdateUser, { params: { id: 'u2' }, body: { is_admin: false } });
    expect(r.statusCode).toBe(200);
    expect(log).toHaveBeenCalledWith('admin-1', 'revoke_admin', 'user', 'u2', null);
  });
  test('dismiss', async () => {
    results = [{ data: { id: 'r1', target_type: 'post', target_id: 'p1', resolved: false } }, { error: null }];
    const r = await call(resolveReport, { params: { id: 'r1' }, body: { action: 'dismiss' } });
    expect(r.body).toEqual({ ok: true, action: 'dismiss', contentRemoved: false });
    expect(log).toHaveBeenCalledWith('admin-1', 'dismiss_report', 'report', 'r1', 'post p1');
  });
  test('broadcast, once confirmed (the dry-run logs nothing)', async () => {
    results = [{ data: [{ id: 'a' }, { id: 'b' }] }];
    const dry = await call(broadcastAnnouncement, { body: { title: 'Hi', body: 'There' } });
    expect(dry.statusCode).toBe(400);
    expect(log).not.toHaveBeenCalled();
    results = [{ data: [{ id: 'a' }, { id: 'b' }] }];
    const ok = await call(broadcastAnnouncement, { body: { title: 'Hi', body: 'There', confirm: true } });
    expect(ok.body).toEqual({ ok: true, recipients: 2, queued: true });
    expect(log).toHaveBeenCalledWith('admin-1', 'broadcast', 'broadcast', 'admin-1', '"Hi" to 2 users');
  });
});

describe('F6 · reports: a failure is a failure', () => {
  test('query error → 500', async () => {
    results = [{ data: null, error: { message: 'boom', code: 'XX000' } }];
    const r = await call(getReports, {});
    expect(r.statusCode).toBe(500);
    expect(r.body).toEqual({ error: 'Could not load reports.' });
  });
  test('a page past the end is still an empty 200', async () => {
    results = [{ data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' }, count: 3 }];
    const r = await call(getReports, { query: { page: '9' } });
    expect(r.statusCode).toBe(200);
    expect(r.body.reports).toEqual([]);
  });
});

describe('F9 · deleted accounts', () => {
  test.each([{ suspended: true }, { is_admin: true }])('%j on a deleted account → 409, nothing changed', async (body) => {
    results = [{ data: { id: 'u2', is_admin: false, deleted_at: '2026-09-01T00:00:00Z' } }];
    const r = await call(adminUpdateUser, { params: { id: 'u2' }, body });
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'This account is deleted.', code: 'ACCOUNT_DELETED' });
    expect(flat().some((q) => q.includes('update:'))).toBe(false);
  });
});

describe('F14 · last-admin guard', () => {
  test('counts live, unsuspended admins only', async () => {
    results = [{ data: { id: 'u2', is_admin: true, deleted_at: null } }, { count: 1 }];
    const r = await call(adminUpdateUser, { params: { id: 'u2' }, body: { is_admin: false } });
    expect(r.body).toEqual({ error: 'Cannot remove the last remaining admin' });
    expect(queries[1].join(' ')).toMatch(/eq:\["is_admin",true\].*is:\["deleted_at",null\].*is:\["suspended_at",null\]/);
  });
});

describe('F10 · dashboard counts', () => {
  test('users, new users and posts leave out deleted rows', async () => {
    const r = await call(getStats, {});
    expect(r.statusCode).toBe(200);
    const q = flat();
    const users = q.filter((s) => s.includes('from:users'));
    expect(users).toHaveLength(2);
    for (const s of users) expect(s).toContain('is:["deleted_at",null]');
    expect(q.find((s) => s.includes('from:community_posts'))).toContain('is:["deleted_at",null]');
  });
});

describe('F12 · otp-diagnostics fingerprint', () => {
  test('a hash, no part of the key', async () => {
    const ENV = process.env.TWOFACTOR_API_KEY;
    process.env.TWOFACTOR_API_KEY = 'abcd-1234-efgh-5678-wxyz';
    try {
      const r = await call(otpDiagnostics, {});
      expect(r.body.keyFingerprint).toMatch(/^[0-9a-f]{12}$/);
      expect(JSON.stringify(r.body)).not.toMatch(/abcd|wxyz/);
    } finally {
      if (ENV === undefined) delete process.env.TWOFACTOR_API_KEY; else process.env.TWOFACTOR_API_KEY = ENV;
    }
  });
});

describe('F13 · broadcast recipients and text', () => {
  const page = (n: number, off = 0) => ({ data: Array.from({ length: n }, (_, i) => ({ id: `u${off + i}` })) });
  test('pages past 1000: 1000 + 1000 + 3 → 2003 recipients', async () => {
    results = [page(1000), page(1000, 1000), page(3, 2000)];
    const r = await call(broadcastAnnouncement, { body: { title: 'Hi', body: 'There' } });
    expect(r.statusCode).toBe(400);
    expect(r.body.recipients).toBe(2003);
    expect(r.body.needsConfirm).toBe(true);
    expect(queries[0].join(' ')).toMatch(/is:\["deleted_at",null\].*is:\["suspended_at",null\].*range:\[0,999\]/);
    expect(queries[2].join(' ')).toContain('range:[2000,2999]');
  });
  test('whitespace title or body → 400; over the caps → 400 in words', async () => {
    expect((await call(broadcastAnnouncement, { body: { title: '   ', body: 'x' } })).body).toEqual({ error: 'title is required' });
    expect((await call(broadcastAnnouncement, { body: { title: 'x', body: ' \n ' } })).body).toEqual({ error: 'body is required' });
    expect((await call(broadcastAnnouncement, { body: { title: 'x'.repeat(BROADCAST_TITLE_MAX + 1), body: 'x' } })).body.error)
      .toBe('Keep the title to 80 characters or fewer.');
    expect((await call(broadcastAnnouncement, { body: { title: 'x', body: 'x'.repeat(BROADCAST_BODY_MAX + 1) } })).body.error)
      .toBe('Keep the message to 500 characters or fewer.');
    expect(queries).toHaveLength(0); // refused before any query
  });
  test('the notification carries the trimmed text', async () => {
    results = [page(1), { error: null }];
    await call(broadcastAnnouncement, { body: { title: '  Hi  ', body: ' There ', confirm: true } });
    await new Promise((r) => setImmediate(r));
    const insert = flat().find((q) => q.includes('from:notifications'))!;
    expect(insert).toContain('"title":"Hi","body":"There"');
  });
});
