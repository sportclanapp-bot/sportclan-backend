/**
 * Audit #53 (11 Oct 2026): the table counted a withdrawn team's played games,
 * but the champion and the awards dropped them — so they could crown a
 * different team from the one on top of the table.
 * League: A beat W twice, B beat A, W beat B; then W withdrew.
 * Table (all games): A 6, B 3, W 3 → A. Old crown (W's games dropped): B 3, A 0 → B.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { championOf } from '../controllers/tournaments.controller';

const T = 't53';
const m = (id: string, a: string, b: string, w: string) => ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', voided_at: null, score_summary: { A: { score: w === a ? 2 : 0 }, B: { score: w === b ? 2 : 0 } }, overs: null, round: 1 });
describe('audit #53: the champion is the top of the table', () => {
  it('a withdrawn team’s played games still count; it is never crowned', async () => {
    db = fakeDb({
      sports: [{ id: 's-fb', slug: 'football', allows_draw: true }],
      tournaments: [{ id: T, format: 'league', sport_id: 's-fb', settings: {}, tiebreaker_rules: [] }],
      tournament_entries: [
        { tournament_id: T, team_id: 'A', status: 'approved', team: { id: 'A', name: 'Lions' } },
        { tournament_id: T, team_id: 'B', status: 'approved', team: { id: 'B', name: 'Tigers' } },
        { tournament_id: T, team_id: 'W', status: 'withdrawn', team: { id: 'W', name: 'Wolves' } },
      ],
      teams: [{ id: 'A', name: 'Lions' }, { id: 'B', name: 'Tigers' }, { id: 'W', name: 'Wolves' }],
      matches: [m('1', 'A', 'W', 'A'), m('2', 'W', 'A', 'A'), m('3', 'A', 'B', 'B'), m('4', 'W', 'B', 'W')],
      match_events: [],
    });
    expect((await championOf(T))?.id).toBe('A');
  });
});
