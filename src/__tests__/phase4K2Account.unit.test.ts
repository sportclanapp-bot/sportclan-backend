/**
 * Phase 4 · K2 — regression tests for the account data export (SC-162): the
 * per-user rate limit on the route, and the posts section (see the app repo's
 * phase4/K2.md). The route runs on a real express app on a local socket with
 * auth and the controllers stubbed; the rate-limit store has no Redis env, so
 * it counts in memory. The controller test mocks Supabase.
 */
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: unknown, next: () => void) => { req.userId = req.headers['x-user']; next(); },
}));

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('K2-30 · POST /account/export-data is rate-limited per user (SC-162)', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    jest.isolateModules(() => {
      jest.doMock('../controllers/account.controller', () => {
        const ok = (_req: unknown, res: any) => res.json({ ok: true });
        return { deleteAccount: ok, getSessions: ok, revokeSession: ok, revokeAllSessions: ok, submitFeedback: ok, exportData: ok, purgeExpiredAccounts: ok };
      });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const router = require('../routes/account.routes').default;
      const app = express();
      app.use('/account', router);
      server = app.listen(0);
    });
    await new Promise<void>((r) => server.once('listening', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const post = (user: string) => fetch(`${base}/account/export-data`, { method: 'POST', headers: { 'x-user': user } });
  it('K2-30 (6197c3a): the 6th export in an hour → 429; another user is not throttled by it', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post(U1)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await post(U2)).status).toBe(200);
  });
});

describe('K2-31 · the export includes the user’s posts (SC-162)', () => {
  it('K2-31 (b6f7560): posts are read from community_posts by author_id and returned', async () => {
    const { exportData } = jest.requireActual('../controllers/account.controller');
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:community_posts' ? { data: [{ id: 'p1', content: 'gg' }] } : q[0] === 'from:users' ? { data: { id: U1 } } : { data: [] });
    const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn() };
    r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
    r.json = jest.fn((b: unknown) => { r.body = b; return r; });
    r.send = jest.fn((b: string) => { r.body = JSON.parse(b); return r; });
    await exportData({ userId: U1, params: {}, query: {}, body: {}, headers: {} }, r);
    const q = mockLog.find((x) => x[0] === 'from:community_posts')!;
    expect(q).toContain(`eq:["author_id","${U1}"]`);
    expect(mockLog.some((x) => x[0] === 'from:posts')).toBe(false);
    expect(r.body.posts).toEqual([{ id: 'p1', content: 'gg' }]);
  });
});
