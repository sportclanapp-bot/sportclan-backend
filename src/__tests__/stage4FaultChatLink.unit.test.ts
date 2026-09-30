/**
 * Stage 4 fault · editing a tournament's sport details wiped its chat link.
 * PATCH wrote sport_metadata raw, replacing the object that also holds the
 * server's `_chat_id` — the tournament chat then couldn't be found. It merges
 * now, keeps server keys ("_…"), and takes string values only, like create.
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
import { updateTournament } from '../controllers/tournaments.controller';

const row = { id: T, created_by: 'me', status: 'upcoming', format: 'league', fixtures_generated: false, sport_id: 'sp', sport_metadata: { _chat_id: 'chat-1', ball: 'tennis' } };
const meta = () => written('tournaments', 'update').find((u) => u.sport_metadata)?.sport_metadata;
beforeEach(() => {
  mockSportSlug = 'cricket';
  mockLog = [];
  mockNext = (q) => (q[0] === 'from:tournaments' ? { data: row } : { data: null });
});

test('an edit keeps the chat link and merges', async () => {
  expect((await run(updateTournament, { body: { sport_metadata: { pitch: 'turf' } } })).statusCode).toBe(200);
  expect(meta()).toEqual({ _chat_id: 'chat-1', ball: 'tennis', pitch: 'turf' });
});
test('an edit can’t set or clear a server key', async () => {
  await run(updateTournament, { body: { sport_metadata: { _chat_id: 'evil', ball: null } } });
  expect(meta()).toEqual({ _chat_id: 'chat-1' });
});
test('non-string values are dropped, as on create; a non-object → 400', async () => {
  await run(updateTournament, { body: { sport_metadata: { overs: 20, ball: 'leather' } } });
  expect(meta()).toEqual({ _chat_id: 'chat-1', ball: 'leather' });
  const bad = await run(updateTournament, { body: { sport_metadata: 'x' } });
  expect(bad.statusCode).toBe(400);
});
