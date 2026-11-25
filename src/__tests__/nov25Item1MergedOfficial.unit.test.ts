/**
 * Fix list 25 Nov 2026, item 1 · 'umpire' and 'official' are one role (Umpire / Referee / Official).
 * Existing 'official' rows keep working; nobody is listed or counted twice; no row is rewritten.
 */
import express from 'express';
import type { AddressInfo } from 'net';
import { fakeDb } from './helpers/fakeSupabase';
import { isOfficialType, officialCategoriesOf } from '../utils/officialCategories';
import { OFFICIATING_TYPES, VALID_ACCOUNT_TYPES, isValidAccountType, normalizeAccountTypes } from '../constants/accountTypes';

let db = fakeDb();
let mockFail = false;
jest.mock('../utils/supabase', () => ({
  get supabase() {
    return { ...db.client, from: (t: string) => {
      if (mockFail && t === 'user_account_types') {
        const c: any = new Proxy({}, { get: (_o, k) => (k === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, count: null, error: { message: 'down' } })) : () => c) });
        return c;
      }
      return db.client.from(t);
    } };
  },
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));
jest.mock('../utils/blocks', () => ({ blockedUserIds: jest.fn(async () => new Set()), excludeIds: (q: unknown) => q }));
jest.mock('../middleware/auth.middleware', () => ({ authenticateToken: (req: any, _res: any, next: any) => { req.userId = 'me'; next(); } }));
// eslint-disable-next-line import/first
import servicesRouter from '../routes/services.routes';

const CITY = '00000000-0000-4000-8000-000000000001';
const user = (id: string, sports: string[], city: string | null = null, extra: Record<string, unknown> = {}) => ({
  id, name: id, username: id, profile_picture_url: null, bio: null, city_id: city, deleted_at: null, suspended_at: null, city: null, sports: sports.map((s) => ({ sport: { slug: s, name: s } })), ...extra,
});
const seed = () => {
  const both = user('both-nosport', []);
  db = fakeDb({ user_account_types: [
    { user_id: 'both-nosport', account_type: 'umpire', users: both },
    { user_id: 'both-nosport', account_type: 'official', users: both },
    { user_id: 'old-official', account_type: 'official', users: user('old-official', [], CITY) },
    { user_id: 'foot', account_type: 'official', users: user('foot', ['football']) },
    { user_id: 'ump', account_type: 'umpire', users: user('ump', ['cricket'], CITY) },
    { user_id: 'gone', account_type: 'official', users: user('gone', ['chess'], null, { deleted_at: '2026-10-01' }) },
    { user_id: 'susp', account_type: 'official', users: user('susp', ['chess'], null, { suspended_at: '2026-10-01' }) },
    { user_id: 'coach', account_type: 'coach', users: user('coach', []) },
  ] });
};
const get = async (p: string) => {
  const app = express(); app.use('/services', servicesRouter);
  const s = app.listen(0);
  try { const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`); return { status: r.status, body: (await r.json()) as any }; } finally { s.close(); }
};
const ids = (b: any) => b.providers.map((p: { id: string }) => p.id).sort();
beforeEach(() => { mockFail = false; seed(); });

it('validation still takes official (old rows, older apps) and nothing is rewritten by it', () => {
  expect(isValidAccountType('official')).toBe(true);
  expect(VALID_ACCOUNT_TYPES).toContain('official');
  expect(OFFICIATING_TYPES).toEqual(['umpire', 'referee', 'official']);
  expect(normalizeAccountTypes(['official', 'umpire', 'player'])).toEqual(['player', 'official', 'umpire']);
  expect(isOfficialType('official') && isOfficialType('umpire')).toBe(true);
  expect(isOfficialType('referee') || isOfficialType('coach')).toBe(false);
});

it('an official with no sports is in one group, whichever value is stored', () => {
  for (const t of [['umpire'], ['official'], ['umpire', 'official'], ['player', 'official']]) expect([...officialCategoriesOf([], t)]).toEqual(['umpires']);
  expect([...officialCategoriesOf([], ['coach'])]).toEqual([]);
  expect([...officialCategoriesOf(['football'], ['official'])]).toEqual(['referees']); // the sports still decide
});

it('the Services cards list each person once', async () => {
  expect(ids((await get('/services?category=umpires')).body)).toEqual(['both-nosport', 'old-official', 'ump']);
  expect(ids((await get('/services?category=referees')).body)).toEqual(['foot']);
  expect(ids((await get('/services?category=arbiters')).body)).toEqual([]); // deleted and suspended are not listed
});

it('the older ?type= lists: one group for either value, each person once, paged, by city', async () => {
  const all = ['both-nosport', 'foot', 'old-official', 'ump'];
  for (const t of ['umpire', 'official', 'OFFICIAL']) {
    const r = (await get(`/services?type=${t}`)).body;
    expect(ids(r)).toEqual(all);
    expect(r.total).toBe(4);
    expect(r.has_more).toBe(false);
  }
  const p1 = (await get('/services?type=umpire&limit=3')).body;
  const p2 = (await get('/services?type=umpire&limit=3&offset=3')).body;
  expect([...ids(p1), ...ids(p2)].sort()).toEqual(all);
  expect([p1.has_more, p2.has_more]).toEqual([true, false]);
  expect(ids((await get(`/services?type=official&city_id=${CITY}`)).body)).toEqual(['old-official', 'ump']);
  expect(ids((await get('/services?type=coach')).body)).toEqual(['coach']); // the other lists as before
});

it('counts: each person once, the same number under either key, and what the list shows', async () => {
  const { counts, categories } = (await get('/services/counts')).body;
  expect([counts.umpire, counts.official, counts.coach]).toEqual([4, 4, 1]);
  expect(categories).toEqual({ umpires: 3, referees: 1, arbiters: 0 });
  const city = (await get(`/services/counts?city_id=${CITY}`)).body;
  expect([city.counts.umpire, city.counts.official]).toEqual([2, 2]);
});

it('a failed read is no number and a 500 list, never a 0 or an empty list', async () => {
  mockFail = true;
  const { counts, categories } = (await get('/services/counts')).body;
  expect([counts.umpire, counts.official, categories]).toEqual([null, null, null]);
  expect((await get('/services?type=official')).status).toBe(500);
});
