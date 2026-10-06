/**
 * Badminton 7.12 (Oct 2026) · the schedule settings (day hours, match length,
 * gap, courts and their names) can be changed after creation — also after the
 * draw — checked when edited; a tournament made of events passes the change to
 * every event. Sport-neutral.
 */
let mockOrganiser = true;
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
  isTournamentOrganiser: jest.fn(async () => mockOrganiser),
  authorizeCarveout: jest.fn(async () => ({ ok: true, viaAdmin: false })),
  logAdminAction: jest.fn(),
}));
jest.mock('../utils/teamVisibility', () => ({ ...jest.requireActual('../utils/teamVisibility'), isTeamDisbanded: jest.fn(async () => false) }));
jest.mock('../utils/tournamentChat', () => ({
  syncTournamentChatMembers: jest.fn(async () => undefined),
  syncAfterSuccess: jest.fn(),
  canOpenTournamentChat: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => undefined) }));
let mockSportSlug = 'badminton';
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSportSlug })) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
jest.mock('../utils/teamAuth', () => ({ ...jest.requireActual('../utils/teamAuth'), isTeamManager: jest.fn(async () => true) }));

// eslint-disable-next-line import/first
import { updateTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { scheduleRefusal } from '../utils/scheduleFields';

const P = '11111111-1111-4111-8111-111111111111';
const E1 = '22222222-2222-4222-8222-222222222222';
const E2 = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const arg = (q: Q, m: string) => JSON.parse(q.find((c) => c.startsWith(`${m}:`))!.slice(m.length + 1));
const run = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: {}, query: {}, body: {}, headers: {}, ...req } as any, r);
  return r;
};
const inserts = (table: string) => mockLog.filter((q) => q[0] === `from:${table}` && has(q, 'insert:')).map((q) => arg(q, 'insert'));
const updates = (table: string) => mockLog.filter((q) => q[0] === `from:${table}` && has(q, 'update:')).map((q) => ({ set: arg(q, 'update')[0], q }));

beforeEach(() => { mockOrganiser = true; mockSportSlug = 'badminton'; mockLog = []; });

const PARENT_ROW = { id: P, name: 'P3 Open', status: 'live', is_parent: true, created_by: 'me', fixtures_generated: false, daily_start_time: '08:00:00', daily_end_time: '20:00:00', match_duration_minutes: 30, buffer_minutes: 5, ground_count: 4, ground_names: null };
const SINGLE = { id: E2, name: 'P3 Cup', status: 'upcoming', created_by: 'me', format: 'knockout', fixtures_generated: true, daily_start_time: '09:00:00', daily_end_time: '18:00:00', match_duration_minutes: 45, buffer_minutes: 10, ground_count: 2, ground_names: ['A', 'B'] };
const edit = (row: object, body: object) => {
  mockLog = [];
  mockNext = (q) => {
    if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: { ...row, ...arg(q, 'update')[0] } };
    if (q[0] === 'from:tournaments' && arg(q, 'eq')[0] === 'parent_id') return { data: [{ id: E1, event_label: 'MS', status: 'upcoming' }] };
    if (q[0] === 'from:tournaments') return { data: row };
    return { data: [], count: 0 };
  };
  return run(updateTournament, { params: { id: (row as any).id }, body });
};

test('the schedule can be changed after creation (and after the draw): hours, length, gap, courts, names', async () => {
  const r = await edit(SINGLE, { daily_start_time: '07:30', match_duration_minutes: 40, buffer_minutes: 0, ground_count: 3, ground_names: [' Court A ', 'Court B', 'Court C'] });
  expect(r.statusCode).toBe(200);
  expect(updates('tournaments')[0].set).toMatchObject({ daily_start_time: '07:30', match_duration_minutes: 40, buffer_minutes: 0, ground_count: 3, ground_names: ['Court A', 'Court B', 'Court C'] });
});

test('a tournament made of events: the change reaches every event', async () => {
  const r = await edit(PARENT_ROW, { ground_count: 6, daily_end_time: '21:00' });
  expect(r.statusCode).toBe(200);
  expect(updates('tournaments').find((u) => arg(u.q, 'eq')[0] === 'parent_id')!.set).toEqual({ daily_end_time: '21:00', ground_count: 6 });
});

test('checked: worded, and against what is already set', async () => {
  expect((await edit(SINGLE, { daily_end_time: '08:00' })).body).toMatchObject({ code: 'BAD_SCHEDULE', field: 'daily_end_time', error: 'The day ends after it starts.' });
  expect(updates('tournaments')).toHaveLength(0);
  expect(scheduleRefusal({ daily_start_time: '7am' })!.error).toBe('Day hours are HH:MM, e.g. 08:00.');
  expect(scheduleRefusal({ match_duration_minutes: 0 })!.error).toBe('A match is 5 to 600 minutes.');
  expect(scheduleRefusal({ buffer_minutes: -1 })!.error).toBe('The gap between matches is 0 to 240 minutes.');
  expect(scheduleRefusal({ ground_count: 0 })!.error).toBe('1 to 50 courts or grounds.');
  expect(scheduleRefusal({ ground_names: ['Court 1', 'court 1'] })!.error).toBe('Two courts have the same name.');
  // cleared values are fine (blank = not set); an untouched form is fine
  expect(scheduleRefusal({ daily_start_time: null, match_duration_minutes: null, ground_names: null })).toBeNull();
  expect(scheduleRefusal({ name: 'x' })).toBeNull();
});
