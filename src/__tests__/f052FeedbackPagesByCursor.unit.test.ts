/**
 * F052 / N-R3C2-4 (launch test plan) · Admin › Feedback paged by offset: marking items
 * done took them out of the open list, so the next 'Load more' skipped as many; two
 * quick taps asked for the same offset and the one after skipped a whole page. The list
 * now pages by a cursor (the last row's time and id), and marking feedback that is
 * already in that state is a 409 with words instead of a silent repeat.
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
import { adminListFeedback, adminUpdateFeedback } from '../controllers/admin.controller';

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: 'admin-1', params: {}, query: {}, body: {}, ...req }, r); return r; };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const row = (id: string, created_at: string) => ({ id, user_id: null, category: 'bug', message: 'm', rating: null, email: null, status: 'open', created_at });

beforeEach(() => { results = []; queries = []; });

describe('GET /admin/feedback pages by cursor', () => {
  it('the first page carries a cursor after its last row', async () => {
    results = [{ data: [row(A, '2026-10-14T10:00:00.5+00:00'), row(B, '2026-10-14T09:00:00+00:00')], count: 5 }];
    const r = await call(adminListFeedback, { query: { status: 'open', limit: '2' } });
    expect(r.body.has_more).toBe(true);
    expect(r.body.next_cursor).toBe(`2026-10-14T09:00:00+00:00|${B}`);
    expect(r.body.total).toBe(5); // older apps still get total / offset
  });

  it('the next page starts after that row (no offset), whatever moved meanwhile', async () => {
    results = [{ data: [row(A, '2026-10-13T08:00:00+00:00')], count: 1 }];
    const r = await call(adminListFeedback, { query: { status: 'open', limit: '2', cursor: `2026-10-14T09:00:00+00:00|${B}` } });
    const q = queries[0].join(' ');
    expect(q).toContain(`or:["created_at.lt.\\"2026-10-14T09:00:00+00:00\\",and(created_at.eq.\\"2026-10-14T09:00:00+00:00\\",id.gt.${B}),created_at.is.null"]`);
    expect(q).toContain('limit:[2]');
    expect(q).not.toContain('range:');
    expect(r.body).toMatchObject({ has_more: false, next_cursor: null, remaining: 1 });
  });

  it('a cursor that is not one is a 400, not a query', async () => {
    const r = await call(adminListFeedback, { query: { cursor: '0,id.gt.x' } });
    expect(r.statusCode).toBe(400);
    expect(queries).toHaveLength(0);
  });
});

describe('PATCH /admin/feedback/:id refuses a stale change', () => {
  it('marking done what another admin already marked done is a 409 with words', async () => {
    results = [{ data: null }, { data: { id: A, status: 'resolved' } }];
    const r = await call(adminUpdateFeedback, { params: { id: A }, body: { status: 'resolved' } });
    expect(queries[0].join(' ')).toContain('neq:["status","resolved"]');
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'Another admin already marked this done. Pull down to refresh.', code: 'ALREADY_SET' });
  });

  it('a real change still goes through', async () => {
    results = [{ data: { id: A, status: 'resolved' } }];
    const r = await call(adminUpdateFeedback, { params: { id: A }, body: { status: 'resolved' } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ feedback: { id: A, status: 'resolved' } });
  });

  it('a missing id is still a 404', async () => {
    results = [{ data: null }, { data: null }];
    const r = await call(adminUpdateFeedback, { params: { id: A }, body: { status: 'open' } });
    expect(r.statusCode).toBe(404);
  });
});
