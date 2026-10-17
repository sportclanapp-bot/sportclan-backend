/**
 * E-107 (Round 6): an organiser named a player-type account as the tournament umpire; it could never
 * take a fixture's seat (403 NOT_AN_UMPIRE before the tournament check). The tournament role is enough;
 * the account type still gates casual matches.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const ORG = id(1); const STRANGER = id(2); const T_OFF = id(3); const CREATOR = id(4); const T = id(10);
const FIX = id(20); const CASUAL = id(21);
const mkDb = () => fakeDb({
  users: [ORG, STRANGER, T_OFF, CREATOR].map((u, i) => ({ id: u, name: `U${i}`, deleted_at: null })),
  user_account_types: [{ user_id: STRANGER, account_type: 'player' }, { user_id: T_OFF, account_type: 'player' }], // nobody holds an umpire type
  tournaments: [{ id: T, created_by: ORG, parent_id: null }],
  tournament_organisers: [],
  tournament_officials: [{ tournament_id: T, user_id: T_OFF, role: 'umpire' }],
  matches: [
    { id: FIX, tournament_id: T, created_by: ORG, umpire_id: null, umpire_offer_by: null, status: 'scheduled', is_ranked: false, team_a_name: 'A', team_b_name: 'B', sport_id: null, voided_at: null },
    { id: CASUAL, tournament_id: null, created_by: CREATOR, umpire_id: null, umpire_offer_by: null, status: 'scheduled', is_ranked: false, team_a_name: 'C', team_b_name: 'D', sport_id: null, voided_at: null },
  ],
  match_participants: [],
});
let db = mkDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
jest.mock('../utils/sportSlug', () => ({ sportSlugOf: jest.fn(async () => 'badminton') }));

// eslint-disable-next-line import/first
import { selfAssignUmpire } from '../controllers/matches.controller';


function call(fn: (req: any, res: any) => Promise<unknown>, userId: string, matchId: string, body: object = {}) {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
  return fn({ userId, params: { id: matchId }, body }, res).then(() => out);
}
const m = (mid: string) => db.t('matches').find((r) => r.id === mid)!;

beforeEach(() => { db = mkDb(); });
it('a player-type tournament umpire takes the fixture seat', async () => {
  const r = await call(selfAssignUmpire, T_OFF, FIX);
  expect(r.status).toBe(200);
  expect(m(FIX).umpire_id).toBe(T_OFF);
});
it('a player-type organiser takes it too', async () => {
  expect((await call(selfAssignUmpire, ORG, FIX)).status).toBe(200);
});
it('a player-type stranger is still refused as not an umpire, on a fixture and on a casual match', async () => {
  for (const mid of [FIX, CASUAL]) {
    const r = await call(selfAssignUmpire, STRANGER, mid);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('NOT_AN_UMPIRE');
  }
});
