/**
 * FORMATS (28 Sep, live): a Render restart cut a completion off after the
 * result was written but before the tournament step, so the last league
 * fixture was never crowned. The app's outbox retries with idempotent: true,
 * and the replay answered "already completed" without finishing the job. The
 * replay now re-runs the (idempotent) advance / crown step.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
const mockRpc = jest.fn(async (..._a: unknown[]): Promise<any> => ({ data: null, error: null }));
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: (...a: unknown[]) => mockRpc(...a) } };
});
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
let mockOrganiser = false;
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => mockOrganiser),
}));
jest.mock('../utils/scoringLease', () => ({
  ...jest.requireActual('../utils/scoringLease'),
  checkLease: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../utils/singles', () => ({
  ...jest.requireActual('../utils/singles'),
  pendingRankedOpponent: jest.fn(async () => ({ pending: false, opponentName: null })),
}));
let mockSport: Record<string, unknown> = { slug: 'badminton', allows_draw: false };
jest.mock('../utils/sportCache', () => ({
  ...jest.requireActual('../utils/sportCache'),
  getSport: jest.fn(async () => mockSport),
}));
jest.mock('../utils/testContent', () => ({
  ...jest.requireActual('../utils/testContent'),
  hideTestFor: jest.fn(async () => false),
}));
const mockNotify = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../utils/notify', () => ({
  ...jest.requireActual('../utils/notify'),
  notifyUsers: (...a: unknown[]) => mockNotify(...a),
  notifyUser: jest.fn(async () => undefined),
}));

const mockAdvance = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../controllers/tournaments.controller', () => ({
  ...jest.requireActual('../controllers/tournaments.controller'),
  advanceTournamentWinner: (...a: unknown[]) => mockAdvance(...a),
}));

// eslint-disable-next-line import/first
import { completeMatch } from '../controllers/matches.controller';

const M = '11111111-1111-4111-8111-111111111111';
const TA = '22222222-2222-4222-8222-222222222222';
const TB = '33333333-3333-4333-8333-333333333333';
const done = { id: M, sport_id: 's', team_a_id: TA, team_b_id: TB, status: 'completed', winner_team_id: TA, created_by: 'org', tournament_id: 'T', round: 1, group_label: null, next_match_id: null, score_summary: {}, voided_at: null };
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await completeMatch({ userId: "org", params: { id: M }, body, headers: {}, get: () => undefined, header: () => undefined } as any, r);
  return r;
};

beforeEach(() => {
  mockAdvance.mockClear();
  mockNext = (q) => (q[0] === 'from:matches' ? { data: { ...done, ...mockRow } } : { data: null });
});
let mockRow: Record<string, unknown> = {};

describe('a replayed completion finishes the tournament step', () => {
  it('idempotent replay of a completed tournament match re-runs advance / crown', async () => {
    mockRow = {};
    const r = await call({ winner_team_id: TA, idempotent: true });
    expect(r.body).toMatchObject({ already_completed: true });
    expect(mockAdvance).toHaveBeenCalledWith(M);
  });
  it('a plain repeat (no idempotent flag) still just says it was already completed', async () => {
    mockRow = {};
    const r = await call({ winner_team_id: TA });
    expect(r.statusCode).toBe(400);
    expect(mockAdvance).not.toHaveBeenCalled();
  });
  it('a casual match or a voided fixture is left alone', async () => {
    mockRow = { tournament_id: null };
    await call({ idempotent: true });
    mockRow = { voided_at: '2026-09-28T10:00:00Z' };
    await call({ idempotent: true });
    expect(mockAdvance).not.toHaveBeenCalled();
  });
});
