/**
 * Phase 4 · K1-52 / K1-53 (SC-67) — the smart-match job is set-based and bulk:
 * a fixed handful of queries however many inactive users a city has, only
 * users in cities with a match today are read, already-notified users are
 * skipped, and claims + notifications go out as ONE insert each.
 * Supabase is mocked: every `from()` is its own query, resolved by mockNext(q).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gte', 'gt', 'lt', 'lte']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null, ...mockNext(q) }));
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/notify', () => ({
  ...jest.requireActual('../utils/notify'),
  allowedRecipients: jest.fn(async (ids: string[]) => ids),
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(),
}));

// eslint-disable-next-line import/first
import { runSmartMatchNotifications } from '../controllers/features.controller';

const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const CANDIDATES = Array.from({ length: 200 }, (_, i) => ({ id: `u${i}`, city_id: i % 2 ? 'pune' : 'mumbai', name: `U${i}` }));

beforeEach(() => {
  mockLog = [];
  mockNext = (q) => {
    if (q[0] === 'from:matches') return { data: [{ id: 'm-pune', team_a_name: 'Pune XI', venue: 'Deccan', city_id: 'pune' }] };
    if (q[0] === 'from:users') return { data: CANDIDATES };
    if (q[0] === 'from:notification_sends' && has(q, 'select:')) return { data: [{ user_id: 'u1' }] };
    return { data: null };
  };
});

describe('SC-67 smart-match job', () => {
  it('K1-52 (2bd8b1f): one matches query, then ONE users query scoped to the cities that have a match today', async () => {
    await runSmartMatchNotifications();
    const users = mockLog.filter((q) => q[0] === 'from:users');
    expect(users).toHaveLength(1);
    expect(users[0]).toContain('in:["city_id",["pune"]]');
    expect(mockLog.filter((q) => q[0] === 'from:matches')).toHaveLength(1);
    // no paging over every inactive user
    expect(users[0].some((c) => c.startsWith('range:'))).toBe(false);
  });

  it('K1-53 (ea8f1e8): 200 candidates → a fixed few queries, one bulk claim, one bulk notification insert', async () => {
    const r = await runSmartMatchNotifications();
    // only Pune users (odd ids) minus u1, who already got it today
    const expected = CANDIDATES.filter((u) => u.city_id === 'pune' && u.id !== 'u1');
    expect(r.sent).toBe(expected.length);
    expect(mockLog.length).toBeLessThanOrEqual(5);
    const inserts = mockLog.filter((q) => has(q, 'insert:'));
    expect(inserts.map((q) => q[0])).toEqual(['from:notification_sends', 'from:notifications']);
    const notifRows = JSON.parse(inserts[1].find((c) => c.startsWith('insert:'))!.slice(7));
    expect(notifRows).toHaveLength(expected.length);
    expect(notifRows.map((n: any) => n.user_id)).not.toContain('u1');
    expect(notifRows[0]).toMatchObject({ type: 'smart_match', data: { matchId: 'm-pune', screen: 'MatchDetail' } });
  });

  it('K1-52 (2bd8b1f): no open match today → no user query at all', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: [] } : { data: null });
    expect(await runSmartMatchNotifications()).toEqual({ sent: 0 });
    expect(mockLog.filter((q) => q[0] === 'from:users')).toHaveLength(0);
  });
});
