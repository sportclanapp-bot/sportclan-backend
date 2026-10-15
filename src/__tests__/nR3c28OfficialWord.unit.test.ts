/**
 * N-R3C2-8 (launch test plan, Round 3): offering to officiate a football / basketball / volleyball match
 * that had an official said 'Match already has an umpire' (cricket's word, no full stop); a player in a
 * ranked match was told 'you can't be its umpire' whatever the sport.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `bcbcbcbc-bcbc-4bcb-8bcb-${String(n).padStart(12, '0')}`;
const REF = id(1); const ME = id(2); const CREATOR = id(3); const TAKEN = id(20); const RANKED = id(21);
const mkDb = () => fakeDb({
  users: [REF, ME, CREATOR].map((u) => ({ id: u, name: 'U', deleted_at: null })),
  user_account_types: [{ user_id: ME, account_type: 'referee' }],
  matches: [
    { id: TAKEN, tournament_id: null, created_by: CREATOR, umpire_id: REF, umpire_offer_by: null, status: 'scheduled', is_ranked: false, team_a_name: 'A', team_b_name: 'B', sport_id: 's', voided_at: null },
    { id: RANKED, tournament_id: null, created_by: CREATOR, umpire_id: null, umpire_offer_by: null, status: 'scheduled', is_ranked: true, team_a_id: null, team_b_id: null, team_a_name: 'A', team_b_name: 'B', sport_id: 's', voided_at: null },
  ],
  match_participants: [{ match_id: RANKED, user_id: ME }],
  team_members: [],
});
let db = mkDb();
let mockSport = 'football';
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
jest.mock('../utils/sportSlug', () => ({ sportSlugOf: jest.fn(async () => mockSport) }));
// eslint-disable-next-line import/first
import { selfAssignUmpire } from '../controllers/matches.controller';

function call(userId: string, matchId: string) {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
  return selfAssignUmpire({ userId, params: { id: matchId }, body: {}, headers: {}, get: () => undefined, header: () => undefined } as any, res).then(() => out);
}
beforeEach(() => { db = mkDb(); });
test.each([['football', 'This match already has a referee.'], ['cricket', 'This match already has an umpire.']])('%s: the seat is taken, in its word', async (sport, words) => {
  mockSport = sport;
  const r = await call(ME, TAKEN);
  expect([r.status, r.body.error]).toEqual([409, words]);
});
test('a player in a ranked football match: not its referee', async () => {
  mockSport = 'football';
  const r = await call(ME, RANKED);
  expect([r.status, r.body.code, r.body.error]).toEqual([409, 'UMPIRE_IS_PLAYER', 'You play in this ranked match, so you can’t be its referee.']);
});
