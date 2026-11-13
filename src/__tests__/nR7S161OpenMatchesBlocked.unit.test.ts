/**
 * Step 2 Batch 14 · N-R7-S161 (SIDE-A10-1): GET /matches/open offered a match you can't join because
 * of a block (POST /join answers 403 'You can’t join this match.'): Home suggested it with 'View & join'.
 * A match whose creator or a player in it is on either side of a block with you is left out.
 * Mocks copied from phase3MatchesB05.
 */
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
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => true),
}));
jest.mock('../utils/scoringLease', () => ({
  ...jest.requireActual('../utils/scoringLease'),
  checkLease: jest.fn(async () => ({ ok: true })),
  claimLease: jest.fn(async () => ({ taken: true, lease: null })),
  takeOverLease: jest.fn(async () => ({ ok: true, lease: null })),
}));
let mockPending = false;
jest.mock('../utils/singles', () => ({
  ...jest.requireActual('../utils/singles'),
  pendingRankedOpponent: jest.fn(async () => ({ pending: mockPending, opponentName: 'QA Device B' })),
}));
jest.mock('../utils/sportCache', () => ({
  ...jest.requireActual('../utils/sportCache'),
  getSport: jest.fn(async () => ({ slug: 'cricket' })),
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s === 'cricket' ? 'sport-cricket' : undefined)) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), activeSportIds: jest.fn(async () => null) }));
jest.mock('../utils/testContent', () => ({ ...jest.requireActual('../utils/testContent'), hideTestFor: jest.fn(async () => false) }));
// eslint-disable-next-line import/first
import { listOpenMatches } from '../controllers/matches.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const BAD = '55555555-5555-4555-8555-555555555555';
const OK = '66666666-6666-4666-8666-666666666666';
const row = (id: string, by: string) => ({ id, created_by: by, sport_id: 's', status: 'scheduled', is_open: true, players_needed: 3, scheduled_at: new Date(Date.now() + 3600e3).toISOString() });
const call = async () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await listOpenMatches({ userId: ME, params: {}, query: {}, body: {}, headers: {} } as any, r);
  return r;
};

beforeEach(() => {
  mockLog = [];
  mockBlocked = new Set([BAD]);
  mockNext = (q) => {
    const s = q.join(' ');
    if (s.startsWith('from:matches') && s.includes('"is_open",true') && !s.includes('count')) return { data: [row('m-bad', BAD), row('m-coplayer', OK), row('m-ok', OK)] };
    if (s.startsWith('from:matches')) return { count: 3, data: null };
    if (s.startsWith('from:match_participants') && s.includes(BAD)) return { data: [{ match_id: 'm-coplayer' }] };
    return { data: [] };
  };
});

test('a match by someone in a block with me, or with them playing in it, is not offered', async () => {
  const r = await call();
  expect(r.statusCode).toBe(200);
  expect(r.body.matches.map((m: { id: string }) => m.id)).toEqual(['m-ok']);
  expect(r.body.total).toBe(1);
});

test('no blocks: all three offered', async () => {
  mockBlocked = new Set();
  const r = await call();
  expect(r.body.matches).toHaveLength(3);
});
