/**
 * N-R7-39 (Step 2, RW-D2-020 on the phone): typing a cricket score for a side with no line-up uses
 * the side's squad from GET /matches/:id/squad/:side (N-RWD2-2). That list still held a member whose
 * account was deleted, so saving failed with 'That player could not be found.' Deleted accounts are
 * never put into a line-up from the squad.
 */
let mockMatch: Record<string, unknown> | null = null;
let mockMembers: Array<{ user_id: string; role: string; user: { deleted_at: string | null } }> = [];
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: jest.fn((t: string) => {
      const chain: any = { filters: [] as string[] };
      for (const m of ['select', 'eq']) chain[m] = jest.fn(() => chain);
      chain.is = jest.fn((c: string) => { chain.filters.push(c); return chain; });
      chain.maybeSingle = jest.fn(async () => ({ data: mockMatch, error: null }));
      chain.then = (ok: (v: unknown) => unknown) => {
        const rows = t === 'team_members' ? mockMembers.filter((r) => !(chain.filters.includes('user.deleted_at') && r.user.deleted_at)) : null;
        return Promise.resolve(ok({ data: rows, error: null }));
      };
      return chain;
    }),
  },
}));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canOfficiateMatch: jest.fn(async () => true) }));
// eslint-disable-next-line import/first
import { getMatchSquad } from '../controllers/squads.controller';

test('a deleted member is left out of the squad line-up', async () => {
  mockMatch = { id: '22222222-2222-4222-8222-222222222222', tournament_id: null, created_by: 'org', team_a_id: 'ta', team_b_id: 'tb', rules: { v: 1 } };
  mockMembers = [{ user_id: 'live1', role: 'player', user: { deleted_at: null } }, { user_id: 'gone', role: 'player', user: { deleted_at: '2026-10-22T00:00:00Z' } }, { user_id: 'live2', role: 'captain', user: { deleted_at: null } }];
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await getMatchSquad({ userId: 'org', params: { id: '22222222-2222-4222-8222-222222222222', side: 'A' } } as never, r);
  expect(r.body.lineup.map((x: { user_id: string }) => x.user_id).sort()).toEqual(['live1', 'live2']);
});
