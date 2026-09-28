/**
 * Phase 4 · K2 — regression tests for the notification fan-out fixes in
 * utils/notify.ts (see the app repo's phase4/K2.md). The REAL notifyUsers runs;
 * Supabase is mocked: every `from()` starts its own query, resolved by
 * `mockNext(q)`.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert']) {
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
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
let mockDeleted = new Set<string>();
jest.mock('../utils/activeUser', () => ({
  ...jest.requireActual('../utils/activeUser'),
  deletedIdSet: jest.fn(async (ids: string[]) => new Set(ids.filter((i) => mockDeleted.has(i)))),
}));
jest.mock('../utils/expoPush', () => ({ sendPushToTokens: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { notifyUsers, allowedRecipients, matchAudienceIds } from '../utils/notify';
// eslint-disable-next-line import/first
import { listNotifications } from '../controllers/notifications.controller';
// eslint-disable-next-line import/first
import { formatTimeIst } from '../utils/scheduleFixtures';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U = (i: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, '0')}`;
const inserts = () => mockLog.filter((q) => q[0] === 'from:notifications' && q.some((c) => c.startsWith('insert:')));
const recipients = () => inserts().flatMap((q) => JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)).map((r: any) => r.user_id));
const payload = { type: 'tournament_update', title: 't', body: 'b', data: {} };

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockDeleted = new Set();
  jest.restoreAllMocks();
});

describe('K2-21 · notifyUsers fan-out filters (SC-134/135/136/137)', () => {
  it('K2-21b (89ce746): the actor never notifies themself (SC-135)', async () => {
    await notifyUsers([ACTOR, U(1)], payload, { actorId: ACTOR });
    expect(recipients()).toEqual([U(1)]);
  });
  it('K2-21c (89ce746): anyone blocked either way with the actor is skipped (SC-134)', async () => {
    mockBlocked = new Set([U(2)]);
    await notifyUsers([U(1), U(2)], payload, { actorId: ACTOR });
    expect(recipients()).toEqual([U(1)]);
  });
  it('K2-21c (89ce746): without an actor (critical/system fan-outs) a block never suppresses the notice', async () => {
    mockBlocked = new Set([U(2)]);
    await notifyUsers([U(1), U(2)], payload);
    expect(recipients()).toEqual([U(1), U(2)]);
  });
  it('K2-21d (89ce746): soft-deleted accounts get no rows (SC-136)', async () => {
    mockDeleted = new Set([U(3)]);
    await notifyUsers([U(1), U(3)], payload);
    expect(recipients()).toEqual([U(1)]);
  });
  it('K2-21e (89ce746): a 1,201-recipient fan-out is inserted in chunks of ≤500 (SC-137)', async () => {
    const many = Array.from({ length: 1201 }, (_, i) => U(i));
    await notifyUsers(many, payload);
    expect(inserts().map((q) => JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)).length)).toEqual([500, 500, 201]);
  });
  it('K2-21e (89ce746): a TOTAL insert failure is logged loudly, not swallowed (SC-137)', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockNext = (q) => (q[0] === 'from:notifications' ? { error: { message: 'insert denied' } } : { data: null });
    await notifyUsers([U(1)], payload);
    expect(err.mock.calls.some((c) => String(c[0]).includes('fanout TOTAL FAILURE (0/1)'))).toBe(true);
  });
});

describe('K2-42 · rating_change obeys the Milestones toggle (SC-232)', () => {
  it('K2-42 (16ccd07): a user with milestones off gets no rating_change; others do', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: [{ id: U(1), notification_preferences: { milestones: false } }, { id: U(2), notification_preferences: {} }] } : { data: null });
    expect(await allowedRecipients([U(1), U(2)], 'rating_change')).toEqual([U(2)]);
  });
});

describe('K2-57a · a match’s audience is its line-up PLUS both entrant teams (SC-270)', () => {
  it('K2-57a (6c38300): matchAudienceIds = participants ∪ team_a/team_b members, deduped', async () => {
    const TA = 'a0000000-0000-4000-8000-000000000001';
    const TB = 'a0000000-0000-4000-8000-000000000002';
    mockNext = (q) => (q[0] === 'from:match_participants' ? { data: [{ user_id: U(1) }] }
      : q[0] === 'from:team_members' ? { data: [{ user_id: U(1) }, { user_id: U(2) }, { user_id: U(3) }] } : { data: null });
    expect((await matchAudienceIds('m1', TA, TB)).sort()).toEqual([U(1), U(2), U(3)]);
    expect(mockLog.find((q) => q[0] === 'from:team_members')).toContain(`in:["team_id",["${TA}","${TB}"]]`);
  });
});

describe('K2-66 · notifications page by offset; reminders say the IST kick-off (SC-296 / Z-11)', () => {
  it('K2-66a (db350b5): listNotifications reads .range(offset…) and reports has_more; unread stays whole-inbox', async () => {
    mockNext = (q) => (q.some((c) => c.startsWith('range:')) && q.some((c) => c.includes('"count":"exact"}')) ? { data: [{ id: 'n1', type: 'x' }], count: 130 }
      : q.some((c) => c.includes('"head":true')) ? { count: 7 } : { data: [] });
    const r: any = { statusCode: 200, body: null };
    r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
    r.json = jest.fn((b: unknown) => { r.body = b; return r; });
    await listNotifications({ userId: ACTOR, query: { limit: '50', offset: '100' } } as any, r);
    const page = mockLog.find((q) => q.some((c) => c.includes('"count":"exact"}')))!;
    expect(page).toContain('range:[100,149]');
    expect(JSON.stringify(r.body)).toContain('"unread');
  });
  it('K2-66b (db350b5): formatTimeIst gives the IST wall-clock time', () => {
    expect(formatTimeIst('2026-10-05T04:00:00Z')).toBe('09:30');
    expect(formatTimeIst('2026-10-05T18:45:00Z')).toBe('00:15');
    expect(formatTimeIst(null)).toBeNull();
  });
});
