/**
 * E-097 / E-096 (Round 6): the app gated Decide (and would gate the umpire &
 * scorer sheet) on can_manage, which for a casual match includes its umpire —
 * but decideMatch and setMatchOfficials allow only the creator. The match page
 * now says can_decide / can_name_officials with the handlers' own rule.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async (_t: string, u: string) => u === 'org') }));
// eslint-disable-next-line import/first
import { getMatch } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { decideMatch } from '../controllers/matchDecision.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.setHeader = () => r; r.set = () => r; return r; };
const M = '11111111-1111-4111-8111-111111111111';
const view = async (userId: string, tournament_id: string | null) => {
  db = fakeDb({ sports: [{ id: 's', slug: 'football' }], tournaments: [{ id: 'T', format: 'league' }], matches: [{ id: M, sport_id: 's', created_by: 'creator', umpire_id: 'ump', status: 'abandoned', tournament_id, team_a_id: 'A', team_b_id: 'B', voided_at: null, score_summary: {} }] });
  const r = res();
  await getMatch({ userId, params: { id: M }, query: {}, header: () => undefined, headers: {} } as any, r);
  return r.body?.match ?? r.body;
};

test('casual match: the creator may decide and name officials, the umpire may not', async () => {
  const c = await view('creator', null);
  expect([c.can_decide, c.can_name_officials]).toEqual([true, true]);
  const u = await view('ump', null);
  expect(u.can_manage).toBe(true); // they may still edit the match
  expect([u.can_decide, u.can_name_officials]).toEqual([false, false]);
});

test('tournament fixture: the organiser, not the umpire', async () => {
  expect((await view('org', 'T')).can_decide).toBe(true);
  expect((await view('ump', 'T')).can_decide).toBe(false);
});

test('and the server refuses the casual umpire, as the flag says', async () => {
  await view('ump', null);
  const r = res();
  await decideMatch({ userId: 'ump', params: { id: M }, body: { decision: 'replay', reason: 'rain' } } as any, r);
  expect(r.statusCode).toBe(403);
});
