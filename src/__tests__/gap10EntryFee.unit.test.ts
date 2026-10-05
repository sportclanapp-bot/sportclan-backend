/**
 * Cricket gap 10 (5 Oct 2026) · the entry fee's paid / not-paid record, kept
 * by the organisers only: they mark it (with a short note); only they get the
 * columns back; a captain withdrawing doesn't see them in the reply.
 */
let mockSportSlug = 'cricket';
let mockOrganiser = true;
let mockManager = false;
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
  isTournamentOrganiser: jest.fn(async () => mockOrganiser),
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

// eslint-disable-next-line import/first
jest.mock('../utils/teamAuth', () => ({ ...jest.requireActual('../utils/teamAuth'), isTeamManager: jest.fn(async () => mockManager) }));

// eslint-disable-next-line import/first
import { updateEntry, getTournament } from '../controllers/tournaments.controller';
const T = '22222222-2222-4222-8222-222222222222';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const run = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: { id: T }, query: {}, body: {}, ...req } as any, r);
  return r;
};
const written = () => mockLog.filter((q) => q[0] === 'from:tournament_entries' && has(q, 'update:')).map((q) => JSON.parse(q.find((c) => c.startsWith('update:'))!.slice(7))[0]);
const entryCall = (body: object) => {
  mockLog = [];
  mockNext = (q) => {
    if (q[0] === 'from:tournament_entries' && has(q, 'update:')) return { data: { id: 'e1', status: body && (body as any).status ? (body as any).status : 'approved', fee_paid_at: '2026-10-06T00:00:00Z', fee_marked_by: 'me', fee_note: 'UPI 4471' } };
    if (q[0] === 'from:tournament_entries') return { data: { id: 'e1', tournament_id: T, team_id: 'a', status: 'approved' } };
    if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', fixtures_generated: true, created_by: 'me', name: 'Cup' } };
    return { data: null };
  };
  return run(updateEntry, { params: { id: T, entryId: 'e1' }, body });
};
beforeEach(() => { mockOrganiser = true; mockManager = false; });

describe('marking the fee', () => {
  test('paid stamps when and who; not paid clears both; a note is trimmed (blank clears)', async () => {
    expect((await entryCall({ fee_paid: true })).statusCode).toBe(200);
    expect(written()[0]).toMatchObject({ fee_marked_by: 'me' });
    expect(typeof written()[0].fee_paid_at).toBe('string');
    await entryCall({ fee_paid: false });
    expect(written()[0]).toEqual({ fee_paid_at: null, fee_marked_by: null });
    await entryCall({ fee_note: '  UPI ref 4471 ' });
    expect(written()[0]).toEqual({ fee_note: 'UPI ref 4471' });
    await entryCall({ fee_note: '  ' });
    expect(written()[0]).toEqual({ fee_note: null });
  });
  test('refused: not yes/no, a long note, someone who isn’t an organiser', async () => {
    expect((await entryCall({ fee_paid: 'yes' })).body.code).toBe('BAD_FEE_PAID');
    expect((await entryCall({ fee_note: 'x'.repeat(121) })).body.code).toBe('BAD_FEE_NOTE');
    mockOrganiser = false;
    mockManager = true; // a captain can withdraw, not mark the fee
    expect((await entryCall({ fee_paid: true })).statusCode).toBe(403);
    expect(written()).toHaveLength(0);
  });
  test('a captain withdrawing gets the entry back without the payment record', async () => {
    mockOrganiser = false;
    mockManager = true;
    const r = await entryCall({ status: 'withdrawn' });
    expect(r.statusCode).toBe(200);
    expect(r.body.entry).toEqual({ id: 'e1', status: 'withdrawn' });
  });
});

describe('reading the tournament', () => {
  const get = async () => {
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { id: T, name: 'Cup' } } : q[0] === 'from:tournament_entries' ? { data: [] } : { data: null, count: 0 });
    await run(getTournament, { params: { id: T } });
    return mockLog.find((q) => q[0] === 'from:tournament_entries')!.find((c) => c.startsWith('select:'))!;
  };
  test('organisers get fee_paid_at and fee_note; nobody else does', async () => {
    expect(await get()).toContain('fee_paid_at, fee_note');
    mockOrganiser = false;
    expect(await get()).not.toContain('fee_');
  });
});
