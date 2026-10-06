/**
 * A small in-memory stand-in for the Supabase query builder, for unit tests of
 * flows that read what they wrote (invite → accept → entry). Supports the
 * filters these controllers use; embeds (`a:b(...)`) are not resolved.
 *
 *   const db = fakeDb({ tournaments: [...], users: [...] });
 *   jest.mock('../utils/supabase', () => ({ supabase: db.client }));
 */
type Row = Record<string, any>;
type Filter = (r: Row) => boolean;

let seq = 0;
export const fakeId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const t = (name: string) => (tables[name] ??= []);
  const log: Array<{ table: string; op: string; arg?: unknown }> = [];

  function from(name: string) {
    const filters: Filter[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    let head = false;
    let wantCount = false;
    let single: 'one' | 'maybe' | null = null;
    let order: Array<[string, boolean]> = [];
    let lim: number | null = null;
    let range: [number, number] | null = null;
    const b: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count) wantCount = true;
        if (opts?.head) head = true;
        return b;
      },
      insert(rows: Row | Row[]) { op = 'insert'; payload = rows; log.push({ table: name, op: 'insert', arg: rows }); return b; },
      update(set: Row) { op = 'update'; payload = set; log.push({ table: name, op: 'update', arg: set }); return b; },
      upsert(rows: Row | Row[]) { op = 'insert'; payload = rows; return b; },
      delete() { op = 'delete'; log.push({ table: name, op: 'delete' }); return b; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b; },
      neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return b; },
      in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return b; },
      is(c: string, v: null) { filters.push((r) => (r[c] ?? null) === v); return b; },
      not(c: string, o: string, v: unknown) { filters.push((r) => (o === 'is' ? (r[c] ?? null) !== v : r[c] !== v)); return b; },
      gt(c: string, v: any) { filters.push((r) => r[c] > v); return b; },
      gte(c: string, v: any) { filters.push((r) => r[c] >= v); return b; },
      lt(c: string, v: any) { filters.push((r) => r[c] < v); return b; },
      lte(c: string, v: any) { filters.push((r) => r[c] <= v); return b; },
      ilike(c: string, p: string) { const re = new RegExp(`^${p.replace(/%/g, '.*')}$`, 'i'); filters.push((r) => re.test(String(r[c] ?? ''))); return b; },
      or() { return b; },
      order(c: string, o?: { ascending?: boolean }) { order.push([c, o?.ascending !== false]); return b; },
      limit(n: number) { lim = n; return b; },
      range(a: number, z: number) { range = [a, z]; return b; },
      single() { single = 'one'; return b; },
      maybeSingle() { single = 'maybe'; return b; },
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        try { return Promise.resolve(ok(run())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
      },
    };
    const match = (r: Row) => filters.every((f) => f(r));
    function shape(rows: Row[]) {
      let out = [...rows];
      for (const [c, asc] of [...order].reverse()) out.sort((a, z) => ((a[c] ?? '') < (z[c] ?? '') ? -1 : (a[c] ?? '') > (z[c] ?? '') ? 1 : 0) * (asc ? 1 : -1));
      if (range) out = out.slice(range[0], range[1] + 1);
      if (lim != null) out = out.slice(0, lim);
      return out;
    }
    function finish(rows: Row[]) {
      const copy = rows.map((r) => ({ ...r }));
      if (single === 'one') return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: 'not one row' } };
      if (single === 'maybe') return { data: copy[0] ?? null, error: null };
      return { data: head ? null : copy, error: null, ...(wantCount ? { count: rows.length } : {}) };
    }
    function run() {
      const rows = t(name);
      if (op === 'insert') {
        const list: Row[] = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: fakeId(), created_at: new Date().toISOString(), ...defaults(name), ...r }));
        if (name === 'tournament_entries') {
          for (const r of list) if (rows.some((x) => x.tournament_id === r.tournament_id && x.team_id === r.team_id)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        }
        if (name === 'tournament_pair_invites') {
          for (const r of list) {
            if (['open', 'pending'].includes(r.status) && rows.some((x) => x.tournament_id === r.tournament_id && x.inviter_id === r.inviter_id && ['open', 'pending'].includes(x.status))) {
              return { data: null, error: { code: '23505', message: 'uq_pair_invites_live' } };
            }
          }
        }
        rows.push(...list);
        return finish(list);
      }
      if (op === 'update') {
        const hit = rows.filter(match);
        for (const r of hit) Object.assign(r, payload);
        return finish(shape(hit));
      }
      if (op === 'delete') {
        const keep = rows.filter((r) => !match(r));
        const gone = rows.filter(match);
        tables[name] = keep;
        return finish(gone);
      }
      return finish(shape(rows.filter(match)));
    }
    return b;
  }
  return { client: { from, rpc: async () => ({ data: null, error: null }) }, tables, t, log };
}

function defaults(table: string): Row {
  switch (table) {
    case 'teams': return { kind: 'club', deleted_at: null };
    case 'tournaments': return { is_parent: false, parent_id: null, entry_kind: 'team', status: 'upcoming' };
    case 'tournament_entries': return { status: 'pending' };
    case 'tournament_pair_invites': return { status: 'pending', entry_id: null, note: null, responded_at: null };
    default: return {};
  }
}
