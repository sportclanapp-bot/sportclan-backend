/**
 * Q19 + Q46 (Dipak, 21 Nov 2026: A): a suspended account is hidden from Services (the lists and
 * their counts) and from Rankings (all-time and monthly, and the rank a profile shows) until the
 * suspension is lifted; its past matches and results stay. RW-G1-200 (Rankings) and RW-G5-073
 * (Services) found it still listed. Embeds are pre-baked on the rows (fakeDb doesn't resolve them),
 * the way PostgREST hands them back; the filters on them are what is under test.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;
const CR = id(900); const VIEWER = id(60); const PUNE = id(800);
const SUSP = '2026-11-20T10:00:00Z';
let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: 'carrom' })) }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), targetUserHidden: jest.fn(async () => false) }));
jest.mock('../middleware/auth.middleware', () => ({ authenticateToken: (_q: unknown, _s: unknown, n: () => void) => n() }));

const tu = (suspended: boolean) => ({ is_test_seed: false, deleted_at: null, suspended_at: suspended ? SUSP : null });
const prof = (n: number, rating: number, suspended = false) => ({ user_id: id(n), sport_id: CR, rating, matches_played: 3, wins: 2, losses: 1, draws: 0, gender_category: null, tu: tu(suspended) });
const user = (n: number, suspended = false) => ({ id: id(n), name: `P${n}`, username: `p${n}`, city_id: PUNE, is_test_seed: false, deleted_at: null, suspended_at: suspended ? SUSP : null });
const umpire = (n: number, suspended = false) => ({ user_id: id(n), account_type: 'umpire', users: { ...user(n, suspended), city: { name: 'Pune' }, sports: [] } });
const res = () => { const r: any = { statusCode: 200, body: null }; r.status = jest.fn((c: number) => { r.statusCode = c; return r; }); r.json = jest.fn((b: unknown) => { r.body = b; return r; }); r.set = jest.fn(() => r); r.setHeader = jest.fn(() => r); return r; };

beforeEach(() => {
  db = fakeDb({
    sports: [{ id: CR, slug: 'carrom', name: 'Carrom' }],
    users: [user(1), user(2, true), user(3), user(4), user(60)],
    user_sport_profiles: [prof(1, 1900), prof(2, 1800, true), prof(3, 1700), prof(4, 1600)],
    user_account_types: [umpire(1), umpire(2, true), umpire(3)],
    user_blocks: [],
  });
});

describe('Rankings', () => {
  test('all-time: the suspended player is not ranked; the others are 1, 2, 3 with no gap', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLeaderboard } = require('../controllers/leaderboard.controller');
    const r = res();
    await getLeaderboard({ userId: VIEWER, query: { sport_id: CR, limit: '10', offset: '0' }, headers: {} } as never, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.leaderboard.map((x: any) => `${x.rank}:${x.name}`)).toEqual(['1:P1', '2:P3', '3:P4']);
    expect(r.body.total).toBe(3);
  });
  test('a profile’s rank does not count a suspended player above it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSportProfile } = require('../controllers/users.controller');
    const r = res();
    await getSportProfile({ userId: VIEWER, params: { id: id(3), sportId: CR }, query: {}, headers: {} } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.profile.globalRank).toBe(2);
  });
  test('the monthly ranking leaves suspended ids out before numbering (suspendedIdSet)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { suspendedIdSet } = require('../utils/activeUser');
    expect([...(await suspendedIdSet([id(1), id(2), id(3)]))]).toEqual([id(2)]);
    const src = require('fs').readFileSync(require('path').join(__dirname, '../controllers/leaderboard.controller.ts'), 'utf8');
    expect(src).toContain('const susMonthly = await suspendedIdSet(ranked.map((r) => r.user_id));');
  });
});

describe('Services', () => {
  const call = async (path: string, query: Record<string, string>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const router = require('../routes/services.routes').default;
    const layer = router.stack.find((l: any) => l.route?.path === path && l.route.methods.get);
    const r = res();
    const handlers = layer.route.stack.map((s: any) => s.handle);
    await handlers[handlers.length - 1]({ userId: VIEWER, query, headers: {} }, r);
    return r;
  };
  test('the Umpires list does not offer a suspended umpire', async () => {
    const r = await call('/', { type: 'umpire' });
    expect(r.statusCode).toBe(200);
    expect(r.body.providers.map((p: any) => p.name)).toEqual(['P1', 'P3']);
  });
  test('the hub’s count is what the list shows', async () => {
    const r = await call('/counts', {});
    expect(r.body.counts.umpire).toBe(2);
  });
  test('the officials’ cards (umpires by sport word) leave it out too', async () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../routes/services.routes.ts'), 'utf8');
    expect(src.match(/\.is\('users\.suspended_at', null\)/g)).toHaveLength(3);
  });
});
