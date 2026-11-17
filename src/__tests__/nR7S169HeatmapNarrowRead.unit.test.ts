/**
 * N-R7-S169 (Step 2 B17, SIDE-A1-2): GET /users/:id/activity-heatmap read every participation of the
 * player with the whole score_summary (1.8 s for 15k matches on the local stack; the case asks < 1 s).
 * The database now returns only completed, unvoided matches touched in the 84-day window, and only
 * score_summary's winner_side. (Supabase mock copied from phase4K3IstDay.unit.test.ts.)
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

const ME = '11111111-1111-4111-8111-111111111111';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('N-R7-S169 · the heatmap reads only what it shows', () => {
  test('the database filters: completed, not voided, in the window; no whole score_summary', async () => {
    await getActivityHeatmap({ params: { id: ME }, userId: ME } as any, res());
    const q = mockLog.find((x) => x[0] === 'from:match_participants' && x.join(' ').includes('team_side'))!.join(' ');
    expect(q).toContain('matches!inner(');
    expect(q).toContain('winner_side:score_summary->>winner_side');
    expect(q).not.toMatch(/[ ,(]score_summary[,)]/);
    expect(q).toContain('eq:["match.status","completed"]');
    expect(q).toContain('is:["match.voided_at",null]');
    expect(q).toMatch(/or:\["completed_at\.gte\.[^,]+,updated_at\.gte\.[^,]+,scheduled_at\.gte\.[^"]+",\{"referencedTable":"match"\}\]/);
  });
  test('a pickup win read through winner_side alone still counts as a win', async () => {
    const now = new Date().toISOString();
    mockNext = (x) => (x[0] === 'from:match_participants' ? { data: [{ team_side: 'B', match: { id: 'm', status: 'completed', winner_team_id: null, team_a_id: null, team_b_id: null, winner_side: 'B', scheduled_at: null, voided_at: null, completed_at: now, updated_at: now } }] } : { data: null });
    const r = res();
    await getActivityHeatmap({ params: { id: ME }, userId: ME } as any, r);
    const cells = (r.body.heatmap as Array<{ matches: number; wins: number }>).filter((c) => c.matches > 0);
    expect(cells).toEqual([expect.objectContaining({ matches: 1, wins: 1 })]);
  });
  test('many pages: one count, then every page at once (no cap), same rows', async () => {
    const now = new Date().toISOString();
    const row = { team_side: 'A', match: { id: 'm', status: 'completed', winner_team_id: null, team_a_id: null, team_b_id: null, winner_side: 'A', scheduled_at: null, voided_at: null, completed_at: now, updated_at: now } };
    mockNext = (x) => {
      if (x[0] !== 'from:match_participants') return { data: null };
      if (x.join(' ').includes('"head":true')) return { count: 2500 };
      const r = x.find((s) => s.startsWith('range:'))!; const [from, to] = JSON.parse(r.slice(6));
      return { data: Array.from({ length: Math.max(0, Math.min(to, 2499) - from + 1) }, () => row) };
    };
    const r = res();
    await getActivityHeatmap({ params: { id: ME }, userId: ME } as any, r);
    const ranges = mockLog.filter((x) => x[0] === 'from:match_participants').flatMap((x) => x.filter((s) => s.startsWith('range:')));
    expect(ranges).toEqual(['range:[0,999]', 'range:[1000,1999]', 'range:[2000,2999]']);
    // one count first, and all three pages asked before any answer was read (Promise.all)
    expect(mockLog.filter((x) => x[0] === 'from:match_participants')[0].join(' ')).toContain('"head":true');
    const cells = (r.body.heatmap as Array<{ matches: number; wins: number }>).filter((c) => c.matches > 0);
    expect(cells.reduce((a, c) => a + c.matches, 0)).toBe(2500);
  });
});
