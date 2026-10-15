/**
 * F059 (launch test plan): adding a venue that is already listed (same name and city) made nothing
 * new and kept the old details (Decision 7), but the answer looked the same as a new venue, so the
 * app said "Venue added". POST /venues now says `existing: true`, and `kept` lists the details the
 * venue already had, so the ones sent were not saved. A new venue answers as before.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'eq', 'is', 'limit', 'update', 'insert', 'ilike']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const done = () => ({ data: null, error: null, ...mockNext(q) });
    chain.single = jest.fn(async () => done());
    chain.maybeSingle = jest.fn(async () => done());
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok(done()));
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string) => start(`rpc:${n}`)) } };
});
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s ? `id-${s}` : undefined)) }));
// eslint-disable-next-line import/first
import { createVenue } from '../controllers/venues.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const PUNE = '55555555-5555-4555-8555-555555555555';
const V = '77777777-7777-4777-8777-777777777777';
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await createVenue({ userId: ME, params: {}, query: {}, body } as never, r);
  return r;
};
const OLD = { id: V, name: 'P3 VERIFY F059 Hall', city_id: PUNE, created_by: 'qa-a', surface: 'Wooden', address: null, sport_id: null, image_url: null, use_count: 0 };

beforeEach(() => { mockLog = []; });

test('the same name and city: existing, and the surface it already had is kept', async () => {
  mockNext = (q) => {
    if (q[0] === 'from:cities') return { data: { id: PUNE } };
    if (q[0] === 'rpc:venue_find_exact') return { data: [OLD] };
    if (q.some((c) => c.startsWith('update:'))) return { data: { ...OLD, address: 'FC Road' } };
    return {};
  };
  const r = await call({ name: 'p3 verify f059 hall', city_id: PUNE, surface: 'Synthetic', address: 'FC Road' });
  expect(r.statusCode).toBe(200);
  expect(r.body).toEqual({ venue: { ...OLD, address: 'FC Road' }, existing: true, kept: ['surface'] });
  expect(mockLog.some((q) => q.some((c) => c.startsWith('insert:')))).toBe(false);
});

test('the same details again: existing, nothing kept back', async () => {
  mockNext = (q) => (q[0] === 'from:cities' ? { data: { id: PUNE } } : q[0] === 'rpc:venue_find_exact' ? { data: [OLD] } : {});
  const r = await call({ name: OLD.name, city_id: PUNE, surface: 'Wooden' });
  expect(r.body).toEqual({ venue: OLD, existing: true, kept: [] });
});

test('a new venue answers as before', async () => {
  mockNext = (q) => {
    if (q[0] === 'from:cities') return { data: { id: PUNE } };
    if (q[0] === 'rpc:venue_find_exact') return { data: [] };
    if (q[0] === 'from:venues' && q.some((c) => c.startsWith('ilike:'))) return { data: [] };
    if (q.some((c) => c.startsWith('insert:'))) return { data: { ...OLD, id: 'new', surface: null } };
    if (q.some((c) => c.startsWith('update:'))) return { data: { ...OLD, id: 'new', surface: 'Synthetic' } };
    return {};
  };
  const r = await call({ name: 'Brand New Ground', city_id: PUNE, surface: 'Synthetic' });
  expect(r.body).toEqual({ venue: { ...OLD, id: 'new', surface: 'Synthetic' } });
});
