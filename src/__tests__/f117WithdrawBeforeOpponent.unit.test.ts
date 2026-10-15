/**
 * F117 (launch test plan, Round 3): a team that had won its semi-final withdrew before the other semi
 * was played — the final ('A v TBD') was abandoned with nobody winning, the other semi's winner then
 * filled a slot of a match that was over, and no champion was ever crowned.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { walkoverOnWithdraw, advanceTournamentWinner } from '../controllers/tournaments.controller';

const ko = (over: object = {}) => ({ tournament_id: 'T', group_label: null, voided_at: null, sport_id: 's', score_summary: {}, third_place: false, bracket: null, ...over });
beforeEach(() => {
  db = fakeDb({
    sports: [{ id: 's', slug: 'badminton' }],
    tournaments: [{ id: 'T', format: 'knockout', status: 'live', settings: {}, champion_team_id: null, name: 'P3 F117' }],
    tournament_entries: ['A', 'B', 'C', 'D'].map((t) => ({ tournament_id: 'T', team_id: t, status: 'approved' })),
    matches: [
      ko({ id: 's1', round: 1, match_no: 1, team_a_id: 'A', team_b_id: 'C', team_a_name: 'A', team_b_name: 'C', status: 'completed', winner_team_id: 'A', next_match_id: 'f', next_slot: 'A' }),
      ko({ id: 's2', round: 1, match_no: 2, team_a_id: 'B', team_b_id: 'D', team_a_name: 'B', team_b_name: 'D', status: 'scheduled', winner_team_id: null, next_match_id: 'f', next_slot: 'B' }),
      ko({ id: 'f', round: 2, match_no: 1, team_a_id: 'A', team_b_id: null, team_a_name: 'A', team_b_name: null, status: 'scheduled', winner_team_id: null, next_match_id: null }),
    ],
  });
});
test('A withdraws while the final is A v TBD: the final waits', async () => {
  db.t('tournament_entries').find((e) => e.team_id === 'A')!.status = 'withdrawn';
  await walkoverOnWithdraw('T', 'A');
  const f = db.t('matches').find((m) => m.id === 'f')!;
  expect([f.status, f.winner_team_id ?? null]).toEqual(['scheduled', null]);
});
test('then B wins the other semi: B takes the final by walkover and is crowned', async () => {
  db.t('tournament_entries').find((e) => e.team_id === 'A')!.status = 'withdrawn';
  await walkoverOnWithdraw('T', 'A');
  Object.assign(db.t('matches').find((m) => m.id === 's2')!, { status: 'completed', winner_team_id: 'B' });
  await advanceTournamentWinner('s2');
  const f = db.t('matches').find((m) => m.id === 'f')!;
  expect([f.team_b_id, f.status, f.winner_team_id]).toEqual(['B', 'abandoned', 'B']);
  expect([db.t('tournaments')[0]!.status, db.t('tournaments')[0]!.champion_team_id]).toEqual(['completed', 'B']);
});
