/**
 * F194 (launch test plan): a venue typed into New match was saved with no city (the app sends none),
 * so it never showed under Venues "In <your city>". It is saved with the match's city, or its
 * creator's; a city-less venue of the same name takes that city instead of being copied; and
 * migration 160 gives the venues already saved without a city their creator's city.
 * Supabase is a recording chain: every from()/rpc() starts its own query and resolves to mockNext(q).
 */
import fs from 'fs';
import path from 'path';

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
    chain.single = jest.fn(async () => { q.push('single'); return done(); });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); return done(); });
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok(done()));
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, a?: unknown) => start(`rpc:${n}:${JSON.stringify(a ?? null)}`)) } };
});
// eslint-disable-next-line import/first
import { venueCityFor, upsertVenue } from '../controllers/venues.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const PUNE = '55555555-5555-4555-8555-555555555555';
const NASHIK = '66666666-6666-4666-8666-666666666666';
const V = '77777777-7777-4777-8777-777777777777';
const has = (q: Q, s: string) => q.some((c) => c.includes(s));

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('the city a match-typed venue is saved with', () => {
  test('the match’s own city when it has one', async () => {
    expect(await venueCityFor(NASHIK, ME)).toBe(NASHIK);
    expect(mockLog).toHaveLength(0);
  });
  test('else the creator’s city (New match sends none)', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { city_id: PUNE } } : {});
    expect(await venueCityFor(undefined, ME)).toBe(PUNE);
    expect(await venueCityFor('', ME)).toBe(PUNE);
  });
  test('no city at all when the creator has none', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { city_id: null } } : {});
    expect(await venueCityFor(null, ME)).toBeNull();
  });
  test('createMatch saves the venue with it', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
    expect(src).toContain("venueCityFor(city_id, userId).then((cityId) => upsertVenue(cleanVenue, cityId, userId, { countUse: true }))");
  });
});

describe('upsertVenue with a city', () => {
  test('a new name is inserted with the city', async () => {
    mockNext = (q) => (q[0].startsWith('rpc:') ? { data: [] } : q.some((c) => c.startsWith('insert:')) ? { data: { id: V } } : { data: [] });
    expect(await upsertVenue('Shivaji Park', PUNE, ME)).toEqual({ id: V });
    const ins = mockLog.find((q) => q.some((c) => c.startsWith('insert:')))!;
    expect(ins.find((c) => c.startsWith('insert:'))).toContain(`"city_id":"${PUNE}"`);
  });
  test('the same name saved with no city takes the city — no second copy', async () => {
    mockNext = (q) => {
      if (q[0].startsWith('rpc:')) return { data: [] };
      if (has(q, 'update:[{"city_id"')) return { data: { id: V, name: 'Shivaji Park', city_id: PUNE, use_count: 3 } };
      if (q[0] === 'from:venues' && has(q, 'ilike:')) return { data: [{ id: V, name: 'shivaji park', city_id: null, use_count: 3 }] };
      return {};
    };
    const row = await upsertVenue('Shivaji Park', PUNE, ME, { countUse: true });
    expect(row).toMatchObject({ id: V, city_id: PUNE, use_count: 4 });
    expect(mockLog.some((q) => has(q, 'insert:'))).toBe(false);
    const adopt = mockLog.find((q) => has(q, 'update:[{"city_id"'))!;
    expect(adopt).toEqual(expect.arrayContaining([`eq:["id","${V}"]`, 'is:["city_id",null]']));
  });
});

describe('migration 160 · venues already saved without a city', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/160_venue_city_backfill.sql'), 'utf8')
    .replace(/--.*$/gm, '');
  test('fills only an empty city, from the venue’s creator, on live venues', () => {
    expect(sql).toMatch(/UPDATE public\.venues v\s+SET city_id = c\.city_id\s+FROM candidates c\s+WHERE v\.id = c\.id AND v\.city_id IS NULL;/);
    expect(sql).toMatch(/JOIN public\.users u ON u\.id = v\.created_by/);
    expect(sql).toMatch(/v\.deleted_at IS NULL/);
  });
  test('never makes a second venue of the same name in a city', () => {
    expect(sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.venues o\s+WHERE o\.city_id = u\.city_id AND lower\(o\.name\) = lower\(v\.name\)/);
    expect(sql).toMatch(/DISTINCT ON \(lower\(v\.name\), u\.city_id\)/);
  });
  test('removes nothing and touches no other column', () => {
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
    expect(sql.match(/\bSET\b/g)).toHaveLength(1);
  });
});
