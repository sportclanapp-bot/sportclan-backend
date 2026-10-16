/**
 * F072 (launch test plan, Round 2): opening a line-up again showed nobody ticked, and saving could
 * only ADD — a saved player couldn't be taken out. A save may now say it is the whole line-up
 * (replace): before the match starts, players left out are removed (archived, audit #25); once it
 * is live, a player already in it stayed and that save was refused — until N-R5-ops-1 (Round 5): taking a player out is always allowed.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
const mockRpc = jest.fn(async (..._a: unknown[]): Promise<any> => ({ data: 1, error: null }));
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`]; mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'upsert', 'like']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null, ...mockNext(q) }));
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: (...a: unknown[]) => mockRpc(...a) } };
});
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => new Set()) }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canOfficiateMatch: jest.fn(async () => true) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'cricket' })) }));
// eslint-disable-next-line import/first
import { addParticipants } from '../controllers/matches.controller';

const P = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const TA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let status = 'scheduled';
let saved: Array<{ id: string; user_id: string; team_side: string; role: string | null }> = [];
const setup = () => {
  mockNext = (q) => {
    if (q[0] === 'from:matches') return { data: { created_by: 'me', status, tournament_id: null, is_ranked: false, team_a_id: TA, team_b_id: TB, sport_id: 's', team_a_name: 'Lions', team_b_name: 'Tigers', format: 'T10', overs: 10, rules: null } };
    if (q[0] === 'from:users') return { data: [1, 2, 3, 4, 5].map((n) => ({ id: P(n), deleted_at: null })) };
    if (q[0] === 'from:team_members') return { data: [1, 2, 3].map((n) => ({ team_id: TA, user_id: P(n) })).concat([4, 5].map((n) => ({ team_id: TB, user_id: P(n) }))) };
    if (q[0] === 'from:match_participants' && q.some((c) => c.startsWith('upsert:'))) return { data: [] };
    if (q[0] === 'from:match_participants') return { data: saved };
    return { data: null };
  };
};
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await addParticipants({ userId: 'me', params: { id: 'm' }, body } as any, r);
  return r;
};
const removed = () => mockRpc.mock.calls.filter((c) => c[0] === 'delete_with_reason').flatMap((c) => (c[1] as { p_ids: string[] }).p_ids);
beforeEach(() => {
  mockLog = []; mockRpc.mockClear(); status = 'scheduled';
  saved = [{ id: 'r1', user_id: P(1), team_side: 'A', role: null }, { id: 'r2', user_id: P(2), team_side: 'A', role: null }, { id: 'r4', user_id: P(4), team_side: 'B', role: null }, { id: 'rt', user_id: P(5), team_side: 'B', role: 'tie:S1' }];
  setup();
});
const lineup = [{ user_id: P(1), team_side: 'A', batting_order: 1 }, { user_id: P(3), team_side: 'A', batting_order: 2 }, { user_id: P(4), team_side: 'B', batting_order: 1 }];

test('before the start: the whole line-up replaces the saved one (player 2 taken out)', async () => {
  const r = await call({ participants: lineup, replace: true });
  expect(r.statusCode).toBe(200);
  expect(removed()).toEqual(['r2']); // a tie's rows (rt) are the tie line-up's, not this screen's
});
test('without replace, as before: only added', async () => {
  expect((await call({ participants: lineup })).statusCode).toBe(200);
  expect(removed()).toEqual([]);
});
// N-R5-ops-1 (Round 5): taking a player out is always allowed, live too (this used to be a 409
// PLAYER_ALREADY_PLAYING, which left a player who had left the team stuck in a live line-up).
test('live: a player can be taken out (archived, not deleted)', async () => {
  status = 'live';
  const r = await call({ participants: lineup, replace: true });
  expect(r.statusCode).toBe(200);
  expect(removed()).toEqual(['r2']);
});
