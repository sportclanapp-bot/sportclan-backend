/**
 * Phase 4 · K3 — recomputeSummary rebuilds score_summary from events, and must
 * carry over the keys set OUTSIDE it: the toss and what completion wrote.
 * matchResult.unit.test.ts checks the fill-loop's shape in the source; this runs it.
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
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'cricket' })) }));

// eslint-disable-next-line import/first
import { recomputeSummary } from '../controllers/scoring.controller';

beforeEach(() => { mockLog = []; });

const stored = {
  A: { runs: 0 }, B: { runs: 0 },
  toss_winner_side: 'B',
  result: 'Pune XI won by 4 runs', winner_side: 'A',
  walkover: true, walkover_reason: 'no-show',
};
const withEvents = (q: Q) => {
  if (q[0] === 'from:matches' && q.includes('maybeSingle')) return { data: { sport_id: 's', score_summary: stored, format: 'T20' } };
  if (q[0] === 'from:match_events') return { data: [{ event_type: 'ball', payload: { team_side: 'A', runs: 4 }, clock_seconds: null, period: 1 }] };
  return { data: null };
};

it('K3-69 (d84c3ad): the toss survives a recompute from events', async () => {
  mockNext = withEvents;
  const s = await recomputeSummary('m1', { persist: false });
  expect(s?.toss_winner_side).toBe('B');
});

it('K3-70 (3c03e23): result, winner_side, walkover and walkover_reason survive a late event\'s recompute too', async () => {
  mockNext = withEvents;
  const s = await recomputeSummary('m1', { persist: false });
  expect(s).toMatchObject({ result: 'Pune XI won by 4 runs', winner_side: 'A', walkover: true, walkover_reason: 'no-show' });
  expect(s?.A?.runs).toBe(4); // the recompute itself still happened
});
