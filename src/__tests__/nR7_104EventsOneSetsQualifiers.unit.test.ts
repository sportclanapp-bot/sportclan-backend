/**
 * N-R7-104 (Step 2 Batch 6, OBS-A4-QPG500): creating a tournament with several
 * events where only one sets qualifiers_per_group answered HTTP 500.
 *
 * The events go in one bulk insert. PostgREST builds the column list from every
 * row's keys, and a row that leaves a key out gets NULL for it (not the column
 * default) — so the knockout event's qualifiers_per_group (NOT NULL DEFAULT 2)
 * became NULL and the insert failed. The fake below behaves like PostgREST: a
 * bulk insert without `defaultToNull: false` nulls the missing keys.
 */
type Q = { table: string; ops: string[]; rows?: unknown; opts?: { defaultToNull?: boolean } };
let mockLog: Q[] = [];
const PARENT = { id: 'parent-1', is_parent: true, status: 'upcoming', name: 'P3 Open', sport_id: 'tt', format: 'knockout', created_by: 'me', venue: 'Hall', start_date: '2026-12-01', end_date: '2026-12-02', sport_metadata: {} };
const NOT_NULL_WITH_DEFAULT: Record<string, unknown> = { qualifiers_per_group: 2, home_away: false, entry_fee: 0, tiebreaker_rules: [], entry_kind: 'team', status: 'upcoming' };
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: Q = { table: t, ops: [] };
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert']) {
      chain[m] = jest.fn(() => { q.ops.push(m); return chain; });
    }
    chain.insert = jest.fn((rows: unknown, opts?: { defaultToNull?: boolean }) => { q.ops.push('insert'); q.rows = rows; q.opts = opts; return chain; });
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok(answer(q)));
    return chain;
  };
  const answer = (q: Q): { data: unknown; error: unknown } => {
    if (q.table === 'chats' && q.ops.includes('insert')) return { data: { id: 'chat-1' }, error: null };
    if (q.table === 'tournaments' && q.ops.includes('maybeSingle')) return { data: { ...PARENT }, error: null };
    if (q.table !== 'tournaments' || !q.ops.includes('insert')) return { data: null, error: null };
    if (!Array.isArray(q.rows)) return { data: { ...(q.rows as object), id: 'parent-1' }, error: null };
    const rows = q.rows as Array<Record<string, unknown>>;
    const cols = new Set(rows.flatMap((r) => Object.keys(r)));
    const keepDefaults = q.opts?.defaultToNull === false;
    const out: Array<Record<string, unknown>> = [];
    for (const [i, r] of rows.entries()) {
      const row: Record<string, unknown> = { ...r, id: `event-${i}` };
      for (const c of cols) {
        if (c in r) continue;
        if (keepDefaults) { if (c in NOT_NULL_WITH_DEFAULT) row[c] = NOT_NULL_WITH_DEFAULT[c]; continue; }
        if (c in NOT_NULL_WITH_DEFAULT) return { data: null, error: { code: '23502', message: `null value in column "${c}" violates not-null constraint` } };
        row[c] = null;
      }
      out.push(row);
    }
    return { data: out, error: null };
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(async () => undefined), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => false) }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => undefined) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'table-tennis' })) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  isTournamentOrganiser: jest.fn(async () => true),
  authorizeCarveout: jest.fn(async () => ({ ok: true, viaAdmin: false })),
  logAdminAction: jest.fn(),
}));

// eslint-disable-next-line import/first
import { createTournament, addEvents } from '../controllers/tournaments.controller';

const run = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: {}, query: {}, body: {}, headers: {}, ...req } as any, r);
  return r;
};
beforeEach(() => { mockLog = []; });

const OPEN = { sport_id: 'tt', name: 'P3 Open', venue: 'Hall', start_date: '2026-12-01', end_date: '2026-12-02' };
const MIXED = [
  { label: 'MS', entry_kind: 'singles', format: 'groups_knockout', max_teams: 8, num_groups: 2, group_size: 4, qualifiers_per_group: 1 },
  { label: 'WS', entry_kind: 'singles', format: 'knockout', max_teams: 8 },
];

describe('N-R7-104: several events, only one sets qualifiers per group', () => {
  test('create: 200, the groups event keeps its 1, the other takes the default 2', async () => {
    const r = await run(createTournament, { body: { ...OPEN, events: MIXED } });
    expect(r.statusCode).toBe(200);
    const evs = r.body.tournament.events;
    expect(evs.map((e: any) => [e.event_label, e.qualifiers_per_group])).toEqual([['MS', 1], ['WS', 2]]);
  });
  test('add events later: the same mix is accepted', async () => {
    const r = await run(addEvents, { params: { id: 'parent-1' }, body: { events: MIXED } });
    expect(r.statusCode).toBe(200);
    expect(r.body.events.map((e: any) => [e.event_label, e.qualifiers_per_group])).toEqual([['MS', 1], ['WS', 2]]);
  });
});
