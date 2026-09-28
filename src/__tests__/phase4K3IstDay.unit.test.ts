/**
 * Phase 4 · K3 — IST-day bugs (SC-392/415). Production runs on a UTC host; a dev
 * box is often IST, where "local midnight" and "IST midnight" coincide and a
 * server-local-midnight bug hides. So local-time setters are made to behave as
 * on a UTC host (setHours → setUTCHours) for the whole file.
 */

type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal', 'like', 'not', 'csv']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const done = () => ({ data: null, error: null, ...mockNext(q) });
    chain.single = jest.fn(async () => { q.push('single'); return done(); });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); return done(); });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(done())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, args?: unknown) => start(`rpc:${n}:${JSON.stringify(args ?? null)}`)) } };
});
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), targetUserHidden: jest.fn(async () => false) }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), allowedRecipients: jest.fn(async (ids: string[]) => ids), sendPushToUsers: jest.fn(async () => undefined), notifyUser: jest.fn(), notifyUnlessBlocked: jest.fn() }));

// eslint-disable-next-line import/first
import { getActivityHeatmap } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { runSmartMatchNotifications } from '../controllers/features.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const at = (iso: string) => jest.useFakeTimers({ now: Date.parse(iso), doNotFake: ['setImmediate', 'setTimeout', 'setInterval', 'nextTick', 'queueMicrotask', 'clearTimeout', 'clearInterval', 'clearImmediate'] });
const played = (ts: { completed_at?: string; updated_at?: string }) => ({
  team_side: 'A', match: { id: 'm', status: 'completed', winner_team_id: null, team_a_id: null, team_b_id: null, score_summary: null, scheduled_at: null, voided_at: null, completed_at: null, updated_at: null, ...ts },
});
const heatmap = async (rows: object[]) => {
  mockNext = (q) => (q[0] === 'from:match_participants' ? { data: rows } : { data: null });
  const r = res();
  await getActivityHeatmap({ params: { id: ME }, userId: ME } as any, r);
  return r.body.heatmap as Array<{ date: string; matches: number }>;
};

beforeEach(() => {
  mockLog = []; mockNext = () => ({ data: null, error: null });
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const utc = Date.prototype.setUTCHours;
  jest.spyOn(Date.prototype, 'setHours').mockImplementation(function (this: Date, ...a: Array<number | undefined>) { return (utc as any).apply(this, a); });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('activity heatmap days are IST days', () => {
  it('K3-36 (5497e96): a match at 00:15 IST lands on that IST day, not the previous UTC one', async () => {
    at('2026-08-05T12:00:00Z');
    const h = await heatmap([played({ completed_at: '2026-08-01T18:45:00Z' })]); // 02 Aug 00:15 IST
    expect(h.find((c) => c.date === '2026-08-02')?.matches).toBe(1);
    expect(h.find((c) => c.date === '2026-08-01')?.matches).toBe(0);
  });
  it('K3-52 (03316fc): the grid ends on today-in-IST, so a match at 01:05 IST is not dropped', async () => {
    at('2026-08-03T20:00:00Z'); // 04 Aug 01:30 IST, still 03 Aug in UTC
    const h = await heatmap([played({ completed_at: '2026-08-03T19:35:55.462Z' })]);
    expect(h.at(-1)).toMatchObject({ date: '2026-08-04', matches: 1 });
    expect(h).toHaveLength(84);
  });
  it('K3-52 (03316fc): the day comes from completed_at, not a later updated_at edit', async () => {
    at('2026-08-10T12:00:00Z');
    const h = await heatmap([played({ completed_at: '2026-08-03T10:00:00Z', updated_at: '2026-08-09T10:00:00Z' })]);
    expect(h.find((c) => c.date === '2026-08-03')?.matches).toBe(1);
    expect(h.find((c) => c.date === '2026-08-09')?.matches).toBe(0);
  });
});

describe('smart-match "today" is the IST day', () => {
  it('K3-38 (f70923c): the open-match window starts at IST midnight on a UTC host', async () => {
    at('2026-08-02T20:00:00Z'); // 03 Aug 01:30 IST
    await runSmartMatchNotifications();
    const q = mockLog.find((x) => x[0] === 'from:matches')!.join();
    expect(q).toContain('gte:["scheduled_at","2026-08-02T18:30:00.000Z"]');
    expect(q).toContain('lt:["scheduled_at","2026-08-03T18:30:00.000Z"]');
  });
});
