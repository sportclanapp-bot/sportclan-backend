/**
 * Round 6 (account types) · a shared Supabase stand-in for the r6* unit suites. Every `from()` starts a
 * query; it resolves to `mock.next(q)`, where `q` lists that query's builder calls (`from:<table>`, …).
 */
export const mock = { log: [] as string[][], next: (_q: string[]): { data?: unknown; error?: unknown } => ({ data: null }) };
export function supabaseStandIn() {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mock.log.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mock.next(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
}
export const res = () => {
  const r: any = { statusCode: 200, body: null, once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
