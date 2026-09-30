/**
 * BUILD 4.11 · open entry vs approval. A captain's entry (Enter, or the join
 * code) waited for the organiser in every tournament; with `settings.entry:
 * 'open'` it's in at once, up to max teams. The app's `is_open: true` — sent
 * on every create by older apps with no choice behind it — stays ignored.
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
jest.mock('../utils/teamAuth', () => ({ ...jest.requireActual('../utils/teamAuth'), isTeamManager: jest.fn(async () => true) }));
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
import { createEntry, createTournament } from '../controllers/tournaments.controller';

const TEAM = '33333333-3333-4333-8333-333333333333';
const setup = (settings: unknown) => {
  mockLog = [];
  mockNext = (q) => {
    if (q[0] === 'from:team_members') return has(q, 'maybeSingle:') ? { data: { role: 'captain' } } : { data: [] };
    if (q[0] === 'from:teams') return { data: { id: TEAM, name: 'P3 XI', sport_id: 'sp', deleted_at: null } };
    if (q[0] === 'from:tournaments') return { data: { id: T, name: 'P3 Cup', status: 'upcoming', sport_id: 'sp', max_teams: 8, registration_deadline: null, fixtures_generated: false, created_by: 'org', settings } };
    if (q[0] === 'from:tournament_entries' && has(q, 'insert:')) return { data: { id: 'e1', status: JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)).status } };
    if (q[0] === 'from:tournament_entries' && has(q, 'update:')) return { data: null };
    if (q[0] === 'from:tournament_entries') return { data: null, count: 0 };
    return { data: [] , count: 0 };
  };
};
const landed = () => written('tournament_entries', 'insert')[0]?.status;

test('by approval (no setting): the entry waits — as before', async () => {
  setup(null);
  const r = await run(createEntry, { body: { team_id: TEAM } });
  expect([r.statusCode, landed()]).toEqual([200, 'pending']);
});
test('open: the entry is in at once', async () => {
  setup({ v: 1, entry: 'open' });
  const r = await run(createEntry, { body: { team_id: TEAM } });
  expect([r.statusCode, landed()]).toEqual([200, 'approved']);
});
test('is_open from an older app is ignored; settings.entry is stored', async () => {
  mockLog = [];
  mockNext = (q) => (q[0] === 'from:tournaments' && has(q, 'insert:') ? { data: { id: T } } : { data: null });
  const body = { sport_id: 'sp', name: 'P3 Open', format: 'knockout', max_teams: 4, entry_fee: 0, start_date: '2026-10-05' };
  await run(createTournament, { body: { ...body, is_open: true } });
  expect(written('tournaments', 'insert')[0].settings).toBeNull();
  mockLog = [];
  await run(createTournament, { body: { ...body, settings: { entry: 'open' } } });
  expect(written('tournaments', 'insert')[0].settings).toEqual({ v: 1, entry: 'open' });
  const bad = await run(createTournament, { body: { ...body, settings: { entry: 'invite' } } });
  expect([bad.statusCode, bad.body.error]).toEqual([400, 'Entry is open or by approval.']);
});
