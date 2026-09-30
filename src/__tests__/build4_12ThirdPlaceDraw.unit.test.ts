/**
 * BUILD 4.12 · the draw makes the third-place match (a bracket of 4 or more,
 * with the setting on), timed before the final; the setting is refused for a
 * league.
 */
let mockSportSlug = 'cricket';
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'upsert']) {
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
jest.mock('../utils/teamVisibility', () => ({ ...jest.requireActual('../utils/teamVisibility'), isTeamDisbanded: jest.fn(async () => false) }));
let mockCanOpenChat = false;
jest.mock('../utils/tournamentChat', () => ({
  syncTournamentChatMembers: jest.fn(async () => undefined),
  syncAfterSuccess: jest.fn(),
  canOpenTournamentChat: jest.fn(async () => mockCanOpenChat),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => undefined) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSportSlug })) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
const T = '22222222-2222-4222-8222-222222222222';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const run = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: { id: T }, query: {}, body: {}, ...req } as any, r);
  return r;
};
const written = (table: string, op: 'insert' | 'update') => mockLog.filter((q) => q[0] === `from:${table}` && has(q, `${op}:`)).map((q) => { const v = JSON.parse(q.find((c) => c.startsWith(`${op}:`))!.slice(op.length + 1)); return op === 'update' ? v[0] : v; });

// eslint-disable-next-line import/first
import { generateFixtures, createTournament } from '../controllers/tournaments.controller';

const setup = (teams: number, settings: unknown, extra: object = {}) => {
  mockLog = [];
  mockSportSlug = 'football';
  mockNext = (q) => {
    if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
    if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: 'sp', format: 'knockout', start_date: '2026-10-05', end_date: '2026-10-05', daily_start_time: '09:00', daily_end_time: '20:00', match_duration_minutes: 60, buffer_minutes: 0, ground_count: 1, settings, ...extra } };
    if (q[0] === 'from:tournament_entries' && has(q, 'select:')) return { data: Array.from({ length: teams }, (_, i) => ({ id: `e${i}`, team_id: `t${i}`, entered_at: `2026-10-01T0${i}:00`, team: { id: `t${i}`, name: `T${i}` } })) };
    if (q[0] === 'from:matches' && has(q, 'insert:')) {
      const ins = JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7));
      return { data: (Array.isArray(ins) ? ins : [ins]).map((r: any, i: number) => ({ id: `m${r.round}-${r.match_no}-${i}`, match_no: r.match_no })) };
    }
    return { data: [] };
  };
};
const inserted = () => mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:')).flatMap((q) => { const v = JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)); return Array.isArray(v) ? v : [v]; });

test('on: a third-place match in the final’s round, before the final in time', async () => {
  setup(4, { v: 1, thirdPlace: true });
  expect((await run(generateFixtures, {})).statusCode).toBe(200);
  const rows = inserted();
  const tp = rows.find((r: any) => r.third_place);
  const final = rows.find((r: any) => r.round === 2 && !r.third_place);
  expect(tp).toMatchObject({ round: 2, match_no: 1, next_match_id: null, team_a_id: null });
  expect(final).toMatchObject({ round: 2, match_no: 0 });
  expect(Date.parse(tp.scheduled_at)).toBeLessThan(Date.parse(final.scheduled_at));
});
test('off, or a bracket of 2: none', async () => {
  setup(4, null);
  await run(generateFixtures, {});
  expect(inserted().some((r: any) => r.third_place)).toBe(false);
  setup(2, { v: 1, thirdPlace: true });
  await run(generateFixtures, {});
  expect(inserted().some((r: any) => r.third_place)).toBe(false);
});
test('a league can’t have one', async () => {
  mockLog = [];
  mockNext = () => ({ data: null });
  const r = await run(createTournament, { body: { sport_id: 'sp', name: 'P3 TP', format: 'league', max_teams: 4, entry_fee: 0, start_date: '2026-10-05', settings: { thirdPlace: true } } });
  expect([r.statusCode, r.body.error]).toEqual([400, 'A third-place match is for a knockout.']);
});
