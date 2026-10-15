/**
 * N-GF2-B2 (launch test plan, Round 3): the pad's "who scored / select the bowler" read each side's
 * team page; a private team refuses anyone outside it, so no player of that side could be credited.
 * GET /matches/:id/roster/:side gives the match's officials that side's members.
 */
let mockMatch: Record<string, unknown> | null = null;
let mockMembers: unknown[] = [];
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: jest.fn((t: string) => {
      const chain: any = {};
      for (const m of ['select', 'eq', 'is', 'not', 'filter']) chain[m] = jest.fn(() => chain);
      chain.maybeSingle = jest.fn(async () => ({ data: mockMatch, error: null }));
      chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: t === 'team_members' ? mockMembers : null, error: null }));
      return chain;
    }),
  },
}));
let mockOfficial = true;
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canOfficiateMatch: jest.fn(async () => mockOfficial) }));
// eslint-disable-next-line import/first
import { getMatchRoster } from '../controllers/squads.controller';

const MID = '22222222-2222-4222-8222-222222222222';
const call = async (side: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await getMatchRoster({ userId: 'org', params: { id: MID, side } } as never, r);
  return r;
};
beforeEach(() => {
  mockOfficial = true;
  mockMatch = { id: MID, tournament_id: null, created_by: 'org', team_a_id: 'ta', team_b_id: 'private' };
  mockMembers = [{ id: 'm1', role: 'captain', user: { id: 'u1', name: 'Kiran' } }];
});
test('the match’s official gets a private side’s members', async () => {
  const r = await call('B');
  expect([r.statusCode, r.body]).toEqual([200, { members: [{ id: 'm1', role: 'captain', user: { id: 'u1', name: 'Kiran' } }] }]);
});
test('nobody else', async () => {
  mockOfficial = false;
  expect((await call('B')).statusCode).toBe(403);
});
