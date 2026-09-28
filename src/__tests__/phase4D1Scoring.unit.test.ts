/**
 * Phase 4 · D1 — scoring bugs fixed in non-fix commits. Supabase harness copied
 * from phase3ScoringB06.unit.test.ts (every from() is its own query, resolved by
 * mockNext(q)).
 *  A5-010  (66c673d): byes / leg-byes did not advance the over in recompute
 *  SC-15-tt (f447ba5): 'table-tennis' fell through to a flat point tally
 *  SC-430  (70a75ce): a second phone could score the same match — no lease check
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'gt', 'gte', 'lt', 'upsert', 'insert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null, ...mockNext(q) }));
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
let mockSlug = 'cricket';
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSlug })) }));
const mockLease = jest.fn(async (): Promise<any> => ({ ok: true }));
jest.mock('../utils/scoringLease', () => ({ ...jest.requireActual('../utils/scoringLease'), checkLease: (...a: unknown[]) => (mockLease as any)(...a) }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canOfficiateMatch: jest.fn(async () => true) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn() }));

// eslint-disable-next-line import/first
import { recomputeSummary, authorizeScorer } from '../controllers/scoring.controller';

const MID = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const withEvents = (events: unknown[]) => {
  mockNext = (q) => {
    if (q[0] === 'from:matches') return { data: { sport_id: 's', score_summary: {}, format: null } };
    if (q[0] === 'from:match_events') return { data: events };
    if (q[0] === 'from:match_participants') return { data: [] };
    return { data: null };
  };
};

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockSlug = 'cricket';
  mockLease.mockReset();
  mockLease.mockImplementation(async () => ({ ok: true }));
});

describe('A5-010 · byes and leg-byes are legal deliveries', () => {
  test('A5-010 (66c673d): recompute counts a bye and a leg-bye as balls; a wide is not', async () => {
    withEvents([
      { event_type: 'ball', payload: { team_side: 'A', runs: 1 } },
      { event_type: 'extra', payload: { team_side: 'A', type: 'B', runs: 2, is_extra: true } },
      { event_type: 'extra', payload: { team_side: 'A', type: 'Lb', runs: 1, is_extra: true } },
      { event_type: 'extra', payload: { team_side: 'A', type: 'Wd', runs: 3, is_extra: true } },
    ]);
    const s = (await recomputeSummary(MID, { persist: false })) as any;
    expect(s.A.runs).toBe(7);
    expect(s.A.balls).toBe(3);
  });
});

describe('SC-15 · the hyphenated table-tennis slug', () => {
  test('SC-15-tt (f447ba5): "table-tennis" is scored in sets, not as a flat point count', async () => {
    mockSlug = 'table-tennis';
    const pt = (side: 'A' | 'B') => ({ event_type: 'score', payload: { team_side: side, kind: 'point', value: 1 } });
    withEvents([...Array(11)].map(() => pt('A')).concat([pt('B'), pt('B')]));
    const s = (await recomputeSummary(MID, { persist: false })) as any;
    expect(s.A.score).toBe(1); // one set won, not 11 points
    expect(s.A.sets).toEqual([11]);
    expect(s.B.points).toBe(2); // the new set in play
  });
});

describe('SC-430 · one scorer per match', () => {
  const match = { id: MID, created_by: ME, umpire_id: null, status: 'live', tournament_id: null };
  test('SC-430 (70a75ce): an authorised scorer without the lease is refused 409 LEASE_LOST', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: match } : { data: null });
    mockLease.mockImplementation(async () => ({ ok: false, code: 'LEASE_LOST', lease: { user_id: 'someone-else' } }));
    const r: any = await authorizeScorer(MID, ME, 'device-2');
    expect(r).toMatchObject({ ok: false, status: 409, code: 'LEASE_LOST' });
    expect(mockLease).toHaveBeenCalledWith(MID, ME, 'device-2');
  });
  test('SC-430 (70a75ce): with the lease, the same caller may score', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: match } : { data: null });
    const r: any = await authorizeScorer(MID, ME, 'device-1');
    expect(r.ok).toBe(true);
  });
});
