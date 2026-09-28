/**
 * Phase 4 · K1 — early community / moderation fixes.
 * Supabase is a recording chain (per query: the table, then each builder call);
 * each awaited query takes the next queued result.
 */
type Result = { data?: unknown; error?: unknown; count?: number | null };
let results: Result[] = [];
let queries: string[][] = [];
jest.mock('../utils/supabase', () => {
  const make = (table: string) => {
    const log: string[] = [`from:${table}`];
    queries.push(log);
    const q: any = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'is', 'in', 'gt', 'gte', 'lt', 'order', 'range', 'or', 'not', 'limit']) {
      q[m] = jest.fn((...a: unknown[]) => { log.push(`${m}:${JSON.stringify(a)}`); return q; });
    }
    const next = () => results.shift() ?? { data: null, error: null, count: 0 };
    q.maybeSingle = jest.fn(async () => next());
    q.single = jest.fn(async () => next());
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, bad);
    return q;
  };
  return { supabase: { from: jest.fn((t: string) => make(t)), rpc: jest.fn(() => make('rpc')) } };
});
jest.mock('../utils/blocks', () => ({
  blockedUserIds: jest.fn(async () => []),
  excludeIds: jest.fn((q: unknown) => q),
  isBlockedBetween: jest.fn(async () => false),
}));
jest.mock('../middleware/admin.middleware', () => ({
  ...jest.requireActual('../middleware/admin.middleware'),
  isAdminUser: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false),
  excludeTest: jest.fn((q: unknown) => q),
  excludeTestEmbed: jest.fn((q: unknown) => q),
}));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), logAdminAction: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import express from 'express';
// eslint-disable-next-line import/first
import { listPosts, reportContent } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { resolveReport } from '../controllers/admin.controller';
// eslint-disable-next-line import/first
import communityRouter from '../routes/community.routes';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: 'me', params: {}, query: {}, body: {}, ...req }, r); return r; };

beforeEach(() => { results = []; queries = []; });

describe('K1-14 (84f3c1e) · GET /community/posts without a token', () => {
  test('K1-14 (84f3c1e): is a 401 from the auth middleware, and the controller never runs', async () => {
    const app = express().use('/community', communityRouter);
    const out = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const srv = app.listen(0, '127.0.0.1', async () => {
        try {
          const port = (srv.address() as { port: number }).port;
          const r = await fetch(`http://127.0.0.1:${port}/community/posts`);
          resolve({ status: r.status, body: await r.json() });
        } catch (e) { reject(e); } finally { srv.close(); }
      });
    });
    expect(out.status).toBe(401);
    expect(queries.filter((q) => q[0] === 'from:community_posts')).toHaveLength(0);
  });
});

describe('K1-23 (8bed921) · profile "My posts" filters by the user_id the app sends', () => {
  test('K1-23 (8bed921): ?user_id= narrows the feed to that author', async () => {
    results = [{ data: [], error: null }];
    const r = await call(listPosts, { query: { user_id: U } });
    expect(r.statusCode).toBe(200);
    const feed = queries.find((q) => q[0] === 'from:community_posts')!;
    expect(feed).toContain(`eq:["author_id","${U}"]`);
  });
});

describe('K1-21a (a90eae1) · a report lands in content_reports, the table the admin queue reads', () => {
  test('K1-21a (a90eae1): { target_type, target_id } is stored as-is in content_reports (not comment_reports)', async () => {
    results = [
      { data: { id: OTHER } }, // the reported user exists
      { data: null }, // no open report from this reporter
      { data: { id: 'rep-1' } }, // the insert
    ];
    const r = await call(reportContent, { body: { target_type: 'user', target_id: OTHER, reason: 'spam' } });
    expect(r.statusCode).toBe(201);
    const ins = queries.find((q) => q.some((c) => c.startsWith('insert:')))!;
    expect(ins[0]).toBe('from:content_reports');
    expect(JSON.parse(ins.find((c) => c.startsWith('insert:'))!.slice(7))[0]).toEqual({
      target_type: 'user', target_id: OTHER, reporter_id: 'me', reason: 'spam',
    });
    expect(queries.some((q) => q[0] === 'from:comment_reports')).toBe(false);
  });
});

describe('K1-21b (a90eae1) · resolving a report that does not exist', () => {
  test('K1-21b (a90eae1): is a 404 and nothing is updated (was a silent { ok: true })', async () => {
    results = [{ data: null, error: null }];
    const r = await call(resolveReport, { userId: 'admin-1', params: { id: 'missing' }, body: { action: 'dismiss' } });
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'Report not found' });
    expect(queries.some((q) => q.some((c) => c.startsWith('update:')))).toBe(false);
  });
});
