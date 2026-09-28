/**
 * Phase 4 · K1 (rows K1-46b, K1-47, K1-48a/c, K1-49, K1-50a/c/d/f) — the
 * fixture claim, fair seeded byes, groups config, the smart-match candidate
 * query, and the migrations behind them run on a real Postgres (PGlite).
 * Harness copied from phase3TournamentsB08: each from() → mockNext(q).
 */
import { spawnSync } from 'child_process';
import path from 'path';

type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  isTournamentOrganiser: jest.fn(async () => true),
  logAdminAction: jest.fn(),
}));
jest.mock('../utils/tournamentChat', () => ({
  syncTournamentChatMembers: jest.fn(async () => undefined), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(),
  allowedRecipients: jest.fn(async (ids: string[]) => ids),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { generateFixtures, createTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { runSmartMatchNotifications } from '../controllers/features.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const SPORT = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: { id: T }, query: {}, body: {}, headers: {}, get: () => undefined, header: () => undefined, ...req }, r);
  return r;
};
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const TOURN = { id: T, status: 'upcoming', sport_id: SPORT, format: 'knockout', start_date: '2026-10-05', end_date: '2026-10-07', daily_start_time: '08:00', daily_end_time: '22:00', match_duration_minutes: 60, buffer_minutes: 0, ground_count: 2, created_by: ME };
const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ team_id: `s${i + 1}`, seed: i + 1, team: { id: `s${i + 1}`, name: `Seed ${i + 1}` } }));

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('K1-46b (214d4d9) · SC-48 fixtures are generated once', () => {
  it('K1-46b (214d4d9): a lost claim with a bracket already there → 409, no matches inserted', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [] }; // the claim found fixtures_generated already true
      if (q[0] === 'from:tournaments') return { data: TOURN };
      if (q[0] === 'from:tournament_entries') return { data: entries(4) };
      if (q[0] === 'from:matches') return { data: null, count: 3 };
      return { data: null };
    };
    const r = await call(generateFixtures, {});
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toBe('Fixtures already generated for this tournament.');
    const claim = mockLog.find((q) => q[0] === 'from:tournaments' && has(q, 'update:'))!.join(' ');
    expect(claim).toContain('"fixtures_generated":true');
    expect(claim).toContain('eq:["fixtures_generated",false]');
    expect(mockLog.some((q) => q[0] === 'from:matches' && has(q, 'insert:'))).toBe(false);
  });
});

describe('K1-48a (74f0668) · SC-58 byes go to the strongest seeds', () => {
  it('K1-48a (74f0668): 5 teams in an 8 bracket — seeds 1, 2, 3 get the byes; 4 plays 5', async () => {
    let n = 0;
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
      if (q[0] === 'from:tournaments') return { data: TOURN };
      if (q[0] === 'from:tournament_entries') return { data: entries(5) };
      if (q[0] === 'from:matches' && has(q, 'insert:')) {
        const rows = JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)) as Array<{ match_no: number }>;
        return { data: rows.map((r) => ({ id: `m${n++}`, match_no: r.match_no })) };
      }
      return { data: null };
    };
    await call(generateFixtures, {});
    const r1 = mockLog.map((q) => q.find((c) => c.startsWith('insert:')))
      .filter(Boolean).map((c) => JSON.parse(c!.slice(7)))
      .find((rows) => Array.isArray(rows) && rows[0]?.round === 1) as Array<{ team_a_id: string | null; team_b_id: string | null }>;
    expect(r1).toHaveLength(4);
    const byes = r1.filter((m) => !m.team_a_id !== !m.team_b_id).map((m) => m.team_a_id ?? m.team_b_id).sort();
    expect(byes).toEqual(['s1', 's2', 's3']);
    const real = r1.find((m) => m.team_a_id && m.team_b_id)!;
    expect([real.team_a_id, real.team_b_id].sort()).toEqual(['s4', 's5']);
  });
});

describe('K1-48c (74f0668) · SC-58 groups config is taken and stored', () => {
  const base = { sport_id: SPORT, name: 'Group Cup', format: 'groups_knockout', max_teams: 8 };
  it('K1-48c (74f0668): num_groups / group_size / qualifiers_per_group reach the insert', async () => {
    mockNext = (q) => (q[0] === 'from:tournaments' && has(q, 'insert:') ? { data: { id: T } } : { data: null });
    await call(createTournament, { body: { ...base, num_groups: 2, group_size: 4, qualifiers_per_group: 1 } });
    const ins = mockLog.find((q) => q[0] === 'from:tournaments' && has(q, 'insert:'))!.join(' ');
    expect(ins).toContain('"num_groups":2');
    expect(ins).toContain('"group_size":4');
    expect(ins).toContain('"qualifiers_per_group":1');
  });
  it.each([[{ num_groups: 0 }], [{ group_size: 1 }], [{ qualifiers_per_group: 0 }]])('K1-48c (74f0668): %j → 400, nothing inserted', async (cfg) => {
    const r = await call(createTournament, { body: { ...base, ...cfg } });
    expect(r.statusCode).toBe(400);
    expect(mockLog.some((q) => has(q, 'insert:'))).toBe(false);
  });
});

describe('K1-49 (7bb1b80) · SC-66 smart-match reaches users who have a city', () => {
  it('K1-49 (7bb1b80): candidates are filtered to the match cities in the DB, with no row cap to starve them', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:matches') return { data: [{ id: 'm1', team_a_name: 'Reds', venue: 'Oval', city_id: 'pune' }] };
      if (q[0] === 'from:users') return { data: [{ id: 'u1', city_id: 'pune' }, { id: 'u2', city_id: 'pune' }] };
      if (q[0] === 'from:notification_sends' && !has(q, 'insert:')) return { data: [] };
      return { data: null, error: null };
    };
    const out = await runSmartMatchNotifications();
    expect(out).toEqual({ sent: 2 });
    const users = mockLog.find((q) => q[0] === 'from:users')!.join(' ');
    expect(users).toContain('in:["city_id",["pune"]]');
    expect(users).not.toMatch(/limit:\[/);
    const notes = mockLog.find((q) => q[0] === 'from:notifications' && has(q, 'insert:'))!.join(' ');
    expect(notes).toContain('"user_id":"u1"');
    expect(notes).toContain('"user_id":"u2"');
  });
});

describe('K1-47 / K1-46b / K1-48c / K1-50 · the migrations on a real Postgres (PGlite)', () => {
  it('K1-47 (fa405e6), K1-46b (214d4d9), K1-48c (74f0668), K1-50a/c/d/f (34c2985): every assertion in phase4K1F1Migrations.mjs passes', () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'phase4K1F1Migrations.mjs')], { encoding: 'utf8', timeout: 120000 });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out).not.toMatch(/^FAIL /m);
    expect((out.match(/^PASS /gm) ?? []).length).toBe(22);
    expect(r.status).toBe(0);
  });
});
