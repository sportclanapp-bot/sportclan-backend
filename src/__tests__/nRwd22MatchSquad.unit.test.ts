/**
 * N-RWD2-2 (launch test plan, Round 2): typing a cricket score for a side with no line-up read the
 * team's page; a private team refuses anyone outside it, so the organiser got 'This team is private'.
 * GET /matches/:id/squad/:side gives the match's officials that side's squad as its line-up.
 */
let mockMatch: Record<string, unknown> | null = null;
let mockMembers: unknown[] = [];
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: jest.fn((t: string) => {
      const chain: any = {};
      for (const m of ['select', 'eq', 'is']) chain[m] = jest.fn(() => chain);
      chain.maybeSingle = jest.fn(async () => ({ data: mockMatch, error: null }));
      chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: t === 'team_members' ? mockMembers : null, error: null }));
      return chain;
    }),
  },
}));
let mockOfficial = true;
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canOfficiateMatch: jest.fn(async () => mockOfficial) }));
// eslint-disable-next-line import/first
import { getMatchSquad, squadLineupOf } from '../controllers/squads.controller';

const MID = '22222222-2222-4222-8222-222222222222';
const call = async (side: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await getMatchSquad({ userId: 'org', params: { id: MID, side } } as never, r);
  return r;
};
beforeEach(() => {
  mockOfficial = true;
  mockMatch = { id: MID, tournament_id: null, created_by: 'org', team_a_id: 'ta', team_b_id: 'private', rules: { v: 1, players: 2 } };
  mockMembers = [{ user_id: 'p', role: 'player' }, { user_id: 'cap', role: 'captain' }, { user_id: 'vc', role: 'vice_captain' }, { user_id: null, role: 'player' }];
});
test('the match’s organiser gets a private side’s squad as its line-up, captain first, up to the players a side', async () => {
  const r = await call('B');
  expect(r.statusCode).toBe(200);
  expect(r.body).toEqual({ lineup: [{ user_id: 'cap', team_side: 'B' }, { user_id: 'vc', team_side: 'B' }] });
});
test('nobody else; a bad side is refused', async () => {
  mockOfficial = false;
  expect((await call('B')).statusCode).toBe(403);
  mockOfficial = true;
  expect((await call('C')).statusCode).toBe(400);
});
test('the order: captain, vice-captain, the rest; no id, no place', () => {
  expect(squadLineupOf([{ user_id: 'p', role: null }, { user_id: 'cap', role: 'captain' }], 'A', 11).map((x) => x.user_id)).toEqual(['cap', 'p']);
});
