/**
 * N-R7-S157 (Step 2 B14 RW-G5-165): a double tap on Save venue sent two POST /venues at once; both
 * looked for the venue, found nothing, and both inserted, so the venue was listed twice. Adds of the
 * same name and city now take turns: the second finds the venue the first made.
 */
type Q = string[];
let rows: any[] = [];
let inserts = 0;
const tick = () => new Promise((r) => setTimeout(r, 5));
jest.mock('../utils/supabase', () => {
  const start = (head: string, args?: any) => {
    const q: string[] = [head];
    let ins: any = null;
    const chain: any = {};
    for (const m of ['select', 'in', 'eq', 'is', 'limit', 'update', 'ilike']) chain[m] = jest.fn(() => chain);
    chain.insert = jest.fn((v: any) => { ins = v; return chain; });
    const done = async () => {
      await tick();
      if (head === 'rpc:venue_find_exact') {
        return { data: rows.filter((r) => r.name.toLowerCase() === String(args.p_name).toLowerCase() && r.city_id === args.p_city_id), error: null };
      }
      if (head === 'from:cities') return { data: { id: args?.city ?? 'c' }, error: null };
      if (ins) { inserts += 1; const row = { id: `v${inserts}`, deleted_at: null, use_count: 0, ...ins }; rows.push(row); return { data: row, error: null }; }
      return { data: null, error: null };
    };
    chain.single = jest.fn(done);
    chain.maybeSingle = jest.fn(done);
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => done().then(ok, bad);
    void q;
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, a: any) => start(`rpc:${n}`, a)) } };
});
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s ? `id-${s}` : undefined)) }));
// eslint-disable-next-line import/first
import { createVenue, upsertVenue } from '../controllers/venues.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const PUNE = '55555555-5555-4555-8555-555555555555';
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await createVenue({ userId: ME, params: {}, query: {}, body } as never, r);
  return r;
};

beforeEach(() => { rows = []; inserts = 0; });

test('two adds of the same venue at once make one venue; the second says it was already listed', async () => {
  const [a, b] = await Promise.all([
    call({ name: 'P3 Fast Save', city_id: PUNE }),
    call({ name: 'P3 Fast Save', city_id: PUNE }),
  ]);
  expect(inserts).toBe(1);
  expect(a.body.venue.id).toBe(b.body.venue.id);
  expect([a.body.existing, b.body.existing].filter(Boolean)).toHaveLength(1);
});

test('different names still add side by side', async () => {
  await Promise.all([upsertVenue('P3 One', PUNE, ME, { countUse: false }), upsertVenue('P3 Two', PUNE, ME, { countUse: false })]);
  expect(inserts).toBe(2);
});

test('a later add of the same name (other case) finds the first', async () => {
  const first = upsertVenue('P3 Again', PUNE, ME, { countUse: false });
  await first;
  const again = await upsertVenue('p3 again', PUNE, ME, { countUse: false });
  expect(inserts).toBe(1);
  expect(again.id).toBe('v1');
});
