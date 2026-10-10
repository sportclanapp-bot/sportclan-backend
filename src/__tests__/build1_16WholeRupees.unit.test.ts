/**
 * BUILD 1.16 · an entry fee or prize is whole rupees, ₹0 to ₹1 crore. 12.5
 * passed validation and the int column refused it (a 500); so did a number
 * past the column's range.
 */
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
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
// eslint-disable-next-line import/first
import { createTournament, updateTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { tournamentDetailsRefusal, MONEY_MAX } from '../utils/tournamentRules';

const run = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: { id: 't1' }, query: {}, body: {}, ...req } as any, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
beforeEach(() => { mockLog = []; mockNext = () => ({ data: null }); });

describe('BUILD 1.16 · whole rupees', () => {
  test.each([
    [{ entry_fee: 12.5 }, 'entry_fee must be whole rupees.'],
    [{ prize_pool: '99.99' }, 'prize_pool must be whole rupees.'],
    // Stage 13 follow-up: no top — bigint columns (migration 141): the largest exact number.
    [{ entry_fee: MONEY_MAX + 2 }, `entry_fee can be at most ₹${MONEY_MAX.toLocaleString('en-IN')}.`],
  ])('%j → %s', (body, error) => {
    expect(tournamentDetailsRefusal(body)).toEqual({ error, code: 'INVALID_AMOUNT' });
  });
  test.each([[{ entry_fee: 0 }], [{ entry_fee: '150' }], [{ prize_pool: MONEY_MAX }], [{ entry_fee: 10_000_001 }], [{ prize_pool: 50_000_000 }], [{ prize_pool: 3e9 }], [{ entry_fee: 999_999_999_999_999 }]])('%j → ok', (body) => {
    expect(tournamentDetailsRefusal(body)).toBeNull();
  });
  test('create with a fee of 12.5 → 400, nothing inserted', async () => {
    const r = await run(createTournament, { body: { sport_id: 'sp', name: 'P3 Fee', format: 'league', max_teams: 4, entry_fee: 12.5, start_date: '2026-10-05' } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_AMOUNT']);
    expect(writes()).toHaveLength(0);
  });
  test('edit with a prize of 99.99 → 400, nothing written', async () => {
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { id: 't1', created_by: 'me', status: 'upcoming', format: 'league', fixtures_generated: false } } : { data: null });
    const r = await run(updateTournament, { body: { prize_pool: 99.99 } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_AMOUNT']);
    expect(writes()).toHaveLength(0);
  });
});
