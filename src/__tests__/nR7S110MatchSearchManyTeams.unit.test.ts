type Q = string[];
type Ans = { rows?: unknown[]; one?: unknown; error?: unknown };
let mockLog: Q[] = [];
let mockDb: (q: Q) => Ans = () => ({ rows: [] });
jest.mock('../utils/supabase', () => {
  const arg = (q: Q, m: string) => { const c = q.find((x) => x.startsWith(`${m}:`)); return c ? JSON.parse(c.slice(m.length + 1)) : null; };
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const answer = () => {
      const a = mockDb(q);
      if (a.error) return { data: null, error: a.error };
      if (a.one !== undefined) return { data: a.one, error: null };
      const all = a.rows ?? [];
      const sel = arg(q, 'select');
      if (sel && sel[1]?.head) return { data: null, error: null, count: all.length };
      const r = arg(q, 'range');
      const lim = arg(q, 'limit');
      let rows = r ? all.slice(r[0], r[1] + 1) : all.slice(0, 1000);
      if (lim) rows = rows.slice(0, lim[0]);
      return { data: rows, error: null, count: sel && sel[1]?.count ? all.length : null };
    };
    chain.single = jest.fn(async () => { q.push('single'); const x = answer(); return { ...x, data: Array.isArray(x.data) ? x.data[0] ?? null : x.data }; });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); const x = answer(); return { ...x, data: Array.isArray(x.data) ? x.data[0] ?? null : x.data }; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(answer())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string) => start(`rpc:${n}`)) } };
});
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => new Set()),
  targetUserHidden: jest.fn(async () => false),
  isBlockedBetween: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));

// eslint-disable-next-line import/first
import { listMatches } from '../controllers/matches.controller';

/**
 * N-R7-S110 (RW-G2-107) · searching past results for a name 228 registered teams
 * share ('FMT Chess') gave a 500: the list's filter carried every matching team's
 * id twice (2 × 200 uuids, ~15 KB of address) and the read was refused. The
 * address now carries the stored side names and only the ids of matches whose
 * registered team's name matches while the stored side name does not.
 */
const ME = '11111111-1111-4111-8111-111111111111';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const arg = (q: Q, m: string) => { const c = q.find((x) => x.startsWith(`${m}:`)); return c ? JSON.parse(c.slice(m.length + 1)) : null; };
const call = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: ME, params: {}, query: {}, body: {}, ...req } as any, r);
  return r;
};
beforeEach(() => { mockLog = []; mockDb = () => ({ rows: [] }); });

test('228 teams share the searched name: the list filter stays short and names no team ids', async () => {
  const teams = Array.from({ length: 228 }, (_, i) => ({ id: uid(1000 + i) }));
  mockDb = (q) => {
    if (q[0] === 'from:teams') return { rows: teams };
    // the renamed-team lookups: one match whose team is now 'FMT Chess A' but whose stored side name is older
    if (q[0] === 'from:matches' && has(q, 'ilike:["nt.name"')) return { rows: has(q, 'select:["id, nt:teams!team_a_id!inner(name)"') ? [{ id: uid(7) }] : [] };
    return { rows: [{ id: uid(7) }, { id: uid(8) }] };
  };
  const r = await call(listMatches, { query: { status: 'completed', q: 'FMT Chess', voided: 'hide' } });
  expect([r.statusCode, r.body?.error]).toEqual([200, undefined]);
  const list = mockLog.find((x) => x[0] === 'from:matches' && has(x, 'range:') && !has(x, 'ilike:["nt.name"'))!;
  const or = arg(list, 'or')[0] as string;
  expect(or).toContain('team_a_name.ilike."%FMT Chess%"');
  expect(or).toContain(`id.in.(${uid(7)})`);
  expect(or).not.toContain(uid(1000));
  expect(or.length).toBeLessThan(300);
  const look = mockLog.filter((x) => has(x, 'ilike:["nt.name"'));
  expect(look).toHaveLength(2);
  expect(arg(look[0], 'or')[0]).toBe('team_a_name.is.null,team_a_name.not.ilike."%FMT Chess%"');
  expect(has(look[0], 'eq:["status","completed"]')).toBe(true);
});
