/**
 * N-R7-S133 (Step 2 B11, SIDE-A4c-2): the award notice read 'The match awarded to P3 S2B11 Club 14 — <reason>'
 * (no verb). It now reads 'The match was awarded to … — <reason>'; 'result stands' and the replay keep theirs.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
const notifyUsers = jest.fn();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: (...a: unknown[]) => notifyUsers(...a), matchAudienceIds: jest.fn(async () => ['u1']), matchFollowerIds: jest.fn(async () => []) }));
jest.mock('../controllers/tournaments.controller', () => ({ ...jest.requireActual('../controllers/tournaments.controller'), advanceTournamentWinner: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { decideMatch } from '../controllers/matchDecision.controller';

const ID = '11111111-1111-4111-8111-111111111111';
const fresh = () => fakeDb({
  sports: [{ id: 's-ch', slug: 'chess' }],
  tournaments: [{ id: 'T', format: 'knockout', settings: {} }],
  matches: [
    { id: ID, sport_id: 's-ch', tournament_id: 'T', created_by: 'org', status: 'live', round: 1, group_label: null, next_match_id: null, next_slot: null, winner_team_id: null, bracket: null, team_a_id: 'L', team_b_id: 'W', team_a_name: 'Lions', team_b_name: 'Wolves', format: null, overs: null, rules: {}, score_summary: {}, voided_at: null, scheduled_at: '2026-09-01T10:00:00Z' },
  ],
});
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await decideMatch({ userId: 'org', params: { id: ID }, body } as any, r);
  return r;
};

it('N-R7-S133: the award notice says the match was awarded', async () => {
  db = fresh(); notifyUsers.mockClear();
  const r = await call({ decision: 'awarded', reason: 'no-show', winner_side: 'A' });
  expect(r.statusCode).toBe(200);
  const body = notifyUsers.mock.calls[0]?.[1]?.body as string;
  expect(body).toMatch(/^The match was awarded to \S/);
  expect(body).toMatch(/ — no-show$/);
});
