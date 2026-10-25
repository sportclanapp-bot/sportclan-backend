/**
 * N-R7-S40 (Step 2 Batch 13, FMT-TTN-DE-08) · double elimination: a player who lost once and then
 * withdrew while their back-draw opponent wasn't known yet. Before: when the opponent dropped in,
 * the back-draw match stayed scheduled with the withdrawn player in it (to be played). Now the
 * arriving side takes it by walkover and goes on, as F117 does for a knockout.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { walkoverOnWithdraw, advanceTournamentWinner } from '../controllers/tournaments.controller';

const de = (over: object = {}) => ({ tournament_id: 'T', group_label: null, voided_at: null, sport_id: 's', score_summary: {}, third_place: false, loser_next_match_id: null, loser_next_slot: null, ...over });
beforeEach(() => {
  db = fakeDb({
    sports: [{ id: 's', slug: 'table-tennis' }],
    tournaments: [{ id: 'T', format: 'knockout', status: 'live', settings: { v: 1, doubleElim: true }, champion_team_id: null, name: 'P3 S40' }],
    tournament_entries: ['A', 'B', 'C', 'D'].map((t) => ({ tournament_id: 'T', team_id: t, status: 'approved' })),
    matches: [
      de({ id: 's1', round: 1, match_no: 1, bracket: 'main', team_a_id: 'A', team_b_id: 'D', team_a_name: 'A', team_b_name: 'D', status: 'completed', winner_team_id: 'A', next_match_id: 'mf', next_slot: 'A', loser_next_match_id: 'b1', loser_next_slot: 'A' }),
      de({ id: 's2', round: 1, match_no: 2, bracket: 'main', team_a_id: 'B', team_b_id: 'C', team_a_name: 'B', team_b_name: 'C', status: 'scheduled', winner_team_id: null, next_match_id: 'mf', next_slot: 'B', loser_next_match_id: 'b1', loser_next_slot: 'B' }),
      de({ id: 'mf', round: 2, match_no: 1, bracket: 'main', team_a_id: 'A', team_b_id: null, team_a_name: 'A', team_b_name: null, status: 'scheduled', winner_team_id: null, next_match_id: 'f', next_slot: 'A', loser_next_match_id: 'bf', loser_next_slot: 'A' }),
      de({ id: 'b1', round: 3, match_no: 1, bracket: 'back', team_a_id: 'D', team_b_id: null, team_a_name: 'D', team_b_name: null, status: 'scheduled', winner_team_id: null, next_match_id: 'bf', next_slot: 'B' }),
      de({ id: 'bf', round: 4, match_no: 1, bracket: 'back', team_a_id: null, team_b_id: null, team_a_name: null, team_b_name: null, status: 'scheduled', winner_team_id: null, next_match_id: 'f', next_slot: 'B' }),
      de({ id: 'f', round: 5, match_no: 1, bracket: 'final', team_a_id: null, team_b_id: null, team_a_name: null, team_b_name: null, status: 'scheduled', winner_team_id: null, next_match_id: null }),
    ],
  });
});
test('D lost once, withdrew; C drops in: D becomes a BYE and C goes on without play', async () => {
  db.t('tournament_entries').find((e) => e.team_id === 'D')!.status = 'withdrawn';
  await walkoverOnWithdraw('T', 'D');
  expect(db.t('matches').find((m) => m.id === 'b1')!.status).toBe('scheduled'); // opponent not known yet: it waits
  Object.assign(db.t('matches').find((m) => m.id === 's2')!, { status: 'completed', winner_team_id: 'B' });
  await advanceTournamentWinner('s2');
  const b1 = db.t('matches').find((m) => m.id === 'b1')!;
  expect([b1.team_a_id ?? null, b1.team_a_name, b1.team_b_id, b1.status, b1.winner_team_id]).toEqual([null, 'BYE', 'C', 'completed', 'C']);
  expect(db.t('matches').find((m) => m.id === 'bf')!.team_b_id).toBe('C');
});
