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
import { notifyUsers, allowedRecipients } from '../utils/notify';

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
