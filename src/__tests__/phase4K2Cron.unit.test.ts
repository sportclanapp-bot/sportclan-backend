/**
 * Phase 4 · K2 — regression tests for the daily notification jobs (smart-match,
 * re-engagement, weekly digest) and their in-process scheduler (see the app
 * repo's phase4/K2.md). Supabase is mocked: every `from()` starts its own
 * query, resolved by `mockNext(q)`.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

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
let mockOptedOut = new Set<string>();
const mockAudience = jest.fn(async (..._a: unknown[]) => [] as string[]);
const mockNotifyUser = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../utils/notify', () => ({
  notifyUser: (...a: unknown[]) => mockNotifyUser(...a),
  notifyUnlessBlocked: jest.fn(),
  allowedRecipients: jest.fn(async (ids: string[]) => ids.filter((i) => !mockOptedOut.has(i))),
  sendPushToUsers: jest.fn(async () => undefined),
  matchAudienceIds: (...a: unknown[]) => mockAudience(...a),
}));

// eslint-disable-next-line import/first
import { runSmartMatchNotifications, runReEngagement, runWeeklyDigest, checkRatingMilestone, runMatchReminderSweep } from '../controllers/features.controller';

const U = (i: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, '0')}`;
const CITY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const isInsert = (q: Q, t: string) => q[0] === `from:${t}` && q.some((c) => c.startsWith('insert:'));
const insertedRows = (q: Q) => { const r = JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)); return Array.isArray(r) ? r : [r]; };
const notifRows = () => mockLog.filter((q) => isInsert(q, 'notifications')).flatMap(insertedRows);
const releases = () => mockLog.filter((q) => q[0] === 'from:notification_sends' && q.some((c) => c.startsWith('delete:')));

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockOptedOut = new Set();
  mockNotifyUser.mockClear();
  jest.restoreAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('K2-24a · the daily jobs catch up on boot and run once a day (SC-139)', () => {
  // Run index.ts's real scheduler block (transpiled) with the three jobs stubbed.
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
  const block = index.slice(index.indexOf('let lastDailyRun'), index.indexOf('setInterval(runDailyWeekly'));
  const js = ts.transpileModule(`${block}\nreturn runDailyWeekly;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const boot = (jobs: Record<string, jest.Mock>) =>
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('runSmartMatchNotifications', 'runReEngagement', 'runWeeklyDigest', js)(jobs.sm, jobs.re, jobs.wd) as () => Promise<void>;
  const flush = () => new Promise((r) => setImmediate(r));
  afterEach(() => jest.useRealTimers());
  it('K2-24a (5c463c2): a boot at 13:30 IST (not 09:xx) still runs today’s jobs; later ticks the same day do not repeat them', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-29T08:00:00Z'), doNotFake: ['setImmediate', 'nextTick'] }); // Tue 13:30 IST
    const jobs = { sm: jest.fn(async () => ({ sent: 0 })), re: jest.fn(async () => ({ sent: 0 })), wd: jest.fn(async () => ({ sent: 0 })) };
    const tick = boot(jobs);
    await flush();
    expect(jobs.sm).toHaveBeenCalledTimes(1);
    expect(jobs.re).toHaveBeenCalledTimes(1);
    expect(jobs.wd).not.toHaveBeenCalled(); // Tuesday — the digest is Monday-only
    jest.setSystemTime(new Date('2026-09-29T10:30:00Z')); // 16:00 IST, same day
    await tick();
    expect(jobs.sm).toHaveBeenCalledTimes(1);
  });
  it('K2-24a (5c463c2): nothing before 09:00 IST; the first tick at/after 09:00 runs; Monday adds the digest', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-28T01:30:00Z'), doNotFake: ['setImmediate', 'nextTick'] }); // Mon 07:00 IST
    const jobs = { sm: jest.fn(async () => ({ sent: 0 })), re: jest.fn(async () => ({ sent: 0 })), wd: jest.fn(async () => ({ sent: 0 })) };
    const tick = boot(jobs);
    await flush();
    expect(jobs.sm).not.toHaveBeenCalled();
    jest.setSystemTime(new Date('2026-09-28T04:45:00Z')); // 10:15 IST
    await tick();
    expect([jobs.sm.mock.calls.length, jobs.wd.mock.calls.length]).toEqual([1, 1]);
  });
});

describe('K2-24b · a failed send releases its claim so it is retried (SC-143)', () => {
  it('K2-24b (5c463c2): smart-match — the bulk insert fails → the whole batch’s notification_sends claims are deleted', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:matches') return { data: [{ id: 'm1', team_a_name: 'A', venue: 'V', city_id: CITY }] };
      if (q[0] === 'from:users') return { data: [{ id: U(1), city_id: CITY }, { id: U(2), city_id: CITY }] };
      if (isInsert(q, 'notifications')) return { error: { message: 'insert denied' } };
      return { data: [] };
    };
    const out = await runSmartMatchNotifications();
    expect(out.sent).toBe(0);
    const rel = releases();
    expect(rel).toHaveLength(1);
    expect(rel[0].join()).toContain(`in:["user_id",["${U(1)}","${U(2)}"]]`);
  });
  it('K2-24b (5c463c2): re-engagement — only the user whose row failed is released; the others still count', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:users') return { data: [{ id: U(1) }, { id: U(2) }] };
      if (isInsert(q, 'notifications')) {
        const rows = insertedRows(q);
        return rows.length > 1 || rows[0].user_id === U(2) ? { error: { message: 'row failed' } } : {};
      }
      return { data: [] };
    };
    const out = await runReEngagement();
    expect(out.sent).toBe(1);
    const rel = releases();
    expect(rel).toHaveLength(1);
    expect(rel[0]).toContain(`eq:["user_id","${U(2)}"]`);
  });
});

describe('K2-25 · cron jobs skip deleted accounts and gate the ROW on prefs (SC-140)', () => {
  const world = (q: Q) => {
    if (q[0] === 'from:matches') return { data: [{ id: 'm1', team_a_name: 'A', venue: 'V', city_id: CITY }] };
    if (q[0] === 'from:users') return { data: [{ id: U(1), city_id: CITY }, { id: U(2), city_id: CITY }] };
    if (q[0] === 'from:follow_relationships') return { data: [{ following_id: U(1) }, { following_id: U(2) }] };
    return { data: [] };
  };
  it.each([
    ['smart-match', runSmartMatchNotifications],
    ['re-engagement', runReEngagement],
    ['weekly digest', runWeeklyDigest],
  ])('K2-25 (178d6b8): %s — the user query excludes soft-deleted accounts; an opted-out user gets no row; no second notifyUser row', async (_n, job) => {
    mockNext = world;
    mockOptedOut = new Set([U(2)]);
    await job();
    expect(mockLog.find((q) => q[0] === 'from:users')).toContain('is:["deleted_at",null]');
    expect(notifRows().map((r) => r.user_id)).toEqual([U(1)]);
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });
});

describe('K2-26 · re-engagement / digest are chunked bulk writes, not per-user loops (SC-141)', () => {
  it('K2-26 (bfacfd5): re-engagement of 150 users → 2 bulk inserts (100/50), one follower count query per chunk', async () => {
    const users = Array.from({ length: 150 }, (_, i) => ({ id: U(i) }));
    mockNext = (q) => (q[0] === 'from:users' ? { data: users } : { data: [] });
    expect((await runReEngagement()).sent).toBe(150);
    expect(mockLog.filter((q) => isInsert(q, 'notifications')).map((q) => insertedRows(q).length)).toEqual([100, 50]);
    expect(mockLog.filter((q) => q[0] === 'from:follow_relationships')).toHaveLength(2);
  });
  it('K2-26 (bfacfd5): a 250-user digest → 3 bulk claims and 3 bulk inserts (100/100/50)', async () => {
    const users = Array.from({ length: 250 }, (_, i) => ({ id: U(i) }));
    mockNext = (q) => (q[0] === 'from:users' ? { data: users }
      : q[0] === 'from:follow_relationships' ? { data: users.map((u) => ({ following_id: u.id })) } : { data: [] });
    const out = await runWeeklyDigest();
    expect(out.sent).toBe(250);
    expect(mockLog.filter((q) => isInsert(q, 'notifications')).map((q) => insertedRows(q).length)).toEqual([100, 100, 50]);
    expect(mockLog.filter((q) => isInsert(q, 'notification_sends')).map((q) => insertedRows(q).length)).toEqual([100, 100, 50]);
  });
});

describe('K2-35 · weekly digest counts THIS week; re-engagement has a cooldown (SC-216 / SC-215)', () => {
  it('K2-35a (a969c74): matches are counted through matches.scheduled_at in the past week; no weekly activity → no digest', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:users') return { data: [{ id: U(1) }, { id: U(2) }] };
      if (q[0] === 'from:match_participants') return { data: [{ user_id: U(1) }] }; // only U1 played this week
      return { data: [] };
    };
    await runWeeklyDigest();
    const mp = mockLog.find((q) => q[0] === 'from:match_participants')!;
    expect(has(mp, 'gte:["matches.scheduled_at"')).toBe(true);
    expect(has(mp, 'lte:["matches.scheduled_at"')).toBe(true);
    expect(notifRows().map((r) => [r.user_id, r.data.matches])).toEqual([[U(1), 1]]);
  });
  it('K2-35c (a969c74): anyone re-engaged in the last 7 days is skipped; the most dormant are reached first', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:notification_sends' && has(q, 'gte:["sent_on"')) return { data: [{ user_id: U(1) }] };
      if (q[0] === 'from:users') return { data: [{ id: U(1) }, { id: U(2) }] };
      return { data: [] };
    };
    await runReEngagement();
    expect(notifRows().map((r) => r.user_id)).toEqual([U(2)]);
    expect(mockLog.find((q) => q[0] === 'from:users')).toContain('order:["last_active_at",{"ascending":true}]');
  });
});

describe('K2-38 · direct-insert notification sites go through notifyUser (prefs-gated, single row)', () => {
  it('K2-38a (14c2633): crossing a rating milestone → ONE notifyUser(rating_milestone), no direct notifications insert', async () => {
    mockNext = (q) => (q[0] === 'from:sports' ? { data: { name: 'Cricket' } } : { data: null });
    await checkRatingMilestone(U(1), 'sport-1', 1190, 1210);
    expect(mockNotifyUser).toHaveBeenCalledTimes(1);
    expect(mockNotifyUser.mock.calls[0][0]).toMatchObject({ userId: U(1), type: 'rating_milestone', data: { milestone: '1200' } });
    expect(mockLog.filter((q) => isInsert(q, 'notifications'))).toHaveLength(0);
  });
  // The other sites are private helpers; their bodies are read instead.
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const body = (text: string, head: string) => { const i = text.indexOf(head); expect(i).toBeGreaterThan(-1); return text.slice(i, text.indexOf('\n}\n', i)); };
  it.each([
    ['controllers/invites.controller.ts', 'async function notifyInviteReceived('],
    ['controllers/notifications.controller.ts', 'export async function weeklyDigest('],
    ['controllers/users.controller.ts', 'async function runSmartNotifications('],
  ])('K2-38b (14c2633): %s — %s notifies via notifyUser, never a raw notifications insert', (f, head) => {
    const b = body(src(f), head);
    expect(b).toContain('notifyUser(');
    expect(b).not.toMatch(/from\('notifications'\)\s*\.insert/);
  });
});

describe('K2-58 · the 15-minute reminder reaches the entrant teams (SC-272)', () => {
  it('K2-58 (af5b627): recipients = matchAudienceIds(match, team_a, team_b) + the umpire, one reminder each', async () => {
    const TA = 'a0000000-0000-4000-8000-000000000001';
    const TB = 'a0000000-0000-4000-8000-000000000002';
    mockAudience.mockImplementation(async () => [U(1), U(2)]);
    mockNext = (q) => (q[0] === 'from:matches'
      ? { data: [{ id: 'm1', team_a_name: 'A', team_b_name: 'B', team_a_id: TA, team_b_id: TB, scheduled_at: new Date(Date.now() + 600000).toISOString(), umpire_id: U(9), status: 'scheduled' }] }
      : { data: null });
    const out = await runMatchReminderSweep();
    expect(mockAudience).toHaveBeenCalledWith('m1', TA, TB);
    expect(mockNotifyUser.mock.calls.map((c) => (c[0] as any).userId).sort()).toEqual([U(1), U(2), U(9)]);
    expect(out.sent).toBe(3);
    // K2-66c (db350b5): the body names the IST kick-off time.
    expect((mockNotifyUser.mock.calls[0][0] as any).body).toMatch(/starts at \d{2}:\d{2} \(~15 min\)/);
    mockAudience.mockImplementation(async () => []);
  });
});
