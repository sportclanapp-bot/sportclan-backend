/**
 * N-RWD3-15 / N-RWD3-16 (launch test plan) · Admin › Reports paged by offset, and its
 * Actioned tab is ordered by when a report was handled — a Restore moved one to the top
 * and shifted every page after it. The list now pages by a cursor (the last row's sort
 * time and id), with how many are left so the app can keep its 'N of total' right.
 * Supabase is a recording chain: each awaited query takes the next queued result.
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
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: {} })) } }));
jest.mock('../utils/tournamentAuth', () => ({ logAdminAction: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { getReports } from '../controllers/admin.controller';

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: 'admin-1', params: {}, query: {}, body: {}, ...req }, r); return r; };
const A = '11111111-1111-4111-8111-111111111111';
const rep = (id: string, resolved_at: string | null) => ({ id, target_type: 'user', target_id: 'u9', reason: 'spam', reporter_id: 'u1', resolved: true, created_at: '2026-10-01T00:00:00+00:00', resolved_at, resolved_action: 'dismissed', actioned_via: null });

beforeEach(() => { results = []; queries = []; });

it('Actioned: the first page names the row the next one starts after', async () => {
  results = [{ data: [rep(A, '2026-10-14T10:00:00+00:00')], count: 3 }, { data: [] }];
  const r = await call(getReports, { query: { status: 'actioned', limit: '1' } });
  expect(r.body.next_cursor).toBe(`2026-10-14T10:00:00+00:00|${A}`);
  expect(r.body.total).toBe(3);
});

it('Actioned with a cursor: after that row by resolved_at then id, not an offset', async () => {
  results = [{ data: [rep(A, null)], count: 1 }, { data: [] }];
  const r = await call(getReports, { query: { status: 'actioned', limit: '1', cursor: `2026-10-14T10:00:00+00:00|${A}` } });
  const q = queries[0].join(' ');
  expect(q).toContain('or:["resolved_at.lt.\\"2026-10-14T10:00:00+00:00\\"');
  expect(q).toContain('order:["resolved_at",{"ascending":false,"nullsFirst":false}]');
  expect(q).not.toContain('range:');
  expect(r.body).toMatchObject({ remaining: 1, has_more: false, next_cursor: null });
});

it('Open with a cursor orders by created_at', async () => {
  results = [{ data: [], count: 0 }];
  const r = await call(getReports, { query: { cursor: `2026-10-14T10:00:00Z|${A}` } });
  expect(queries[0].join(' ')).toContain('or:["created_at.lt.\\"2026-10-14T10:00:00Z\\"');
  expect(r.body).toMatchObject({ reports: [], remaining: 0, has_more: false });
});

it('a bad cursor is a 400', async () => {
  const r = await call(getReports, { query: { cursor: 'x' } });
  expect(r.statusCode).toBe(400);
});
