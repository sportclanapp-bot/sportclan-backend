/**
 * N-R7-S167 (Step 2 B16, SIDE-C2-2): renaming a team (PATCH /teams/:id) updated teams.name,
 * but its tournament fixtures kept team_a_name / team_b_name = the old name (the column is a
 * copy written when the fixtures are drawn, and attachTeamNames only fills missing names), so
 * the court board, NEXT HERE and READY TO GO still showed the old name. A rename now carries
 * the new name onto that team's match rows that still show the old one; a free-text opponent
 * label (no team id, or a different label) is left alone.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/teamAuth', () => ({
  isTeamManager: jest.fn(async () => true),
  isTeamCaptain: jest.fn(async () => true),
  getTeamRole: jest.fn(async () => 'captain'),
}));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatsForTeam: jest.fn(), syncAfterSuccess: jest.fn() }));
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(), notifyUsers: jest.fn() }));
jest.mock('../utils/sports', () => ({ validateSportForCreate: jest.fn(async () => null) }));
// eslint-disable-next-line import/first
import { updateTeam } from '../controllers/teams.controller';

const TEAM = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const call = async (req: any) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await updateTeam({ userId: 'me', params: { id: TEAM }, query: {}, ...req } as any, r);
  return r;
};
const match = (id: string): any => db.t('matches').find((m: any) => m.id === id);

beforeEach(() => {
  db = fakeDb({
    teams: [{ id: TEAM, name: 'Court T04', sport_id: 's1', captain_id: 'me' }, { id: OTHER, name: 'Rivals', sport_id: 's1' }],
    matches: [
      { id: 'm1', team_a_id: TEAM, team_b_id: OTHER, team_a_name: 'Court T04', team_b_name: 'Rivals' },
      { id: 'm2', team_a_id: OTHER, team_b_id: TEAM, team_a_name: 'Rivals', team_b_name: 'Court T04' },
      { id: 'm3', team_a_id: TEAM, team_b_id: null, team_a_name: 'Court T04', team_b_name: "Rahul's XI" },
      { id: 'm4', team_a_id: TEAM, team_b_id: OTHER, team_a_name: 'TBD', team_b_name: 'Rivals' },
    ],
  });
});

it('a rename reaches the fixtures on both sides (board, NEXT HERE, READY TO GO read these)', async () => {
  const r = await call({ body: { name: 'Subrahmanyam Chandrasekharan Pillai Club' } });
  expect(r.statusCode).toBe(200);
  expect(match('m1').team_a_name).toBe('Subrahmanyam Chandrasekharan Pillai Club');
  expect(match('m2').team_b_name).toBe('Subrahmanyam Chandrasekharan Pillai Club');
  expect(match('m3').team_a_name).toBe('Subrahmanyam Chandrasekharan Pillai Club');
});

it('other labels are left alone: the opponent, a free-text side, and a different label', async () => {
  await call({ body: { name: 'New Name' } });
  expect(match('m1').team_b_name).toBe('Rivals');
  expect(match('m3').team_b_name).toBe("Rahul's XI");
  expect(match('m4').team_a_name).toBe('TBD');
});

it('an edit without a name change does not touch matches', async () => {
  await call({ body: { is_public: false } });
  expect(db.log.filter((l: any) => l.table === 'matches' && l.op === 'update')).toHaveLength(0);
});
