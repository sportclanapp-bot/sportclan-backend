/**
 * N-RWD3-13 (launch test plan) · the server let an admin Dismiss (or Remove) a report
 * that was already handled, so a second admin's stale Dismiss turned a 'Removed' report
 * into 'Dismissed' and its Restore was lost. Dismiss and Remove are now for open reports
 * only: a handled one is a 409 with words, and the dismiss write itself only touches a
 * report that is still open (another admin between the read and the write wins).
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
import { resolveReport } from '../controllers/admin.controller';
// eslint-disable-next-line import/first
import { logAdminAction } from '../utils/tournamentAuth';

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: 'admin-2', params: {}, query: {}, body: {}, ...req }, r); return r; };
const updates = () => queries.filter((q) => q.some((x) => x.startsWith('update:')));
const log = logAdminAction as jest.Mock;

beforeEach(() => { results = []; queries = []; log.mockClear(); });

const removed = { data: { id: 'r1', target_type: 'post', target_id: 'p1', resolved: true, resolved_action: 'removed' } };

it("a second admin's Dismiss on a removed report is refused and writes nothing", async () => {
  results = [removed];
  const r = await call(resolveReport, { params: { id: 'r1' }, body: { action: 'dismiss' } });
  expect(r.statusCode).toBe(409);
  expect(r.body).toEqual({ error: 'Another admin already handled this report. It is in Actioned now.', code: 'ALREADY_HANDLED' });
  expect(updates()).toHaveLength(0);
  expect(log).not.toHaveBeenCalled();
});

it('a Remove on a handled report is refused too', async () => {
  results = [{ data: { ...removed.data, resolved_action: 'dismissed' } }];
  const r = await call(resolveReport, { params: { id: 'r1' }, body: { action: 'remove' } });
  expect(r.statusCode).toBe(409);
  expect(r.body.code).toBe('ALREADY_HANDLED');
  expect(updates()).toHaveLength(0);
});

it('the dismiss write only touches an open report: lost a race → 409, nothing logged', async () => {
  results = [{ data: { id: 'r1', target_type: 'post', target_id: 'p1', resolved: false } }, { data: [], error: null }];
  const r = await call(resolveReport, { params: { id: 'r1' }, body: { action: 'dismiss' } });
  expect(updates()[0].join(' ')).toContain('eq:["resolved",false]');
  expect(r.statusCode).toBe(409);
  expect(log).not.toHaveBeenCalled();
});

it('an open report is still dismissed', async () => {
  results = [{ data: { id: 'r1', target_type: 'post', target_id: 'p1', resolved: false } }, { data: [{ id: 'r1' }], error: null }];
  const r = await call(resolveReport, { params: { id: 'r1' }, body: { action: 'dismiss' } });
  expect(r.body).toEqual({ ok: true, action: 'dismiss', contentRemoved: false });
  expect(log).toHaveBeenCalledWith('admin-2', 'dismiss_report', 'report', 'r1', 'post p1');
});
