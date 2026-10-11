/**
 * Audit #58 (11 Oct 2026): a Swiss dropped a withdrawn player's games from the
 * scores used for pairing, so whoever had beaten them lost that point.
 * A beat W in round 1, then W withdrew; B beat C; D beat E. Round 2 pairs the
 * three 1-pointers (A, B, D) together — A must not drop to the 0-point group.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { swissContext, swissPairRound } from '../controllers/tournaments.controller';

const T = 't58';
const r1 = (id: string, a: string, b: string, w: string) => ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', voided_at: null, bracket: null, round: 1, score_summary: {}, scheduled_at: '2026-10-11T04:00:00Z', overs: null });
describe('audit #58: a withdrawn player’s games still count in a Swiss', () => {
  it('the player who beat them keeps that point for the next pairing', async () => {
    db = fakeDb({
      sports: [{ id: 's-ch', slug: 'chess' }],
      tournaments: [{ id: T, name: 'Swiss', sport_id: 's-ch', format: 'swiss', settings: { swiss: { rounds: 4, tpn: ['A', 'W', 'B', 'C', 'D', 'E'], paired: 1 } }, tiebreaker_rules: [] }],
      tournament_entries: ['A', 'B', 'C', 'D', 'E'].map((x) => ({ tournament_id: T, team_id: x, status: 'approved', team: { name: x } }))
        .concat([{ tournament_id: T, team_id: 'W', status: 'withdrawn', team: { name: 'W' } }]),
      matches: [r1('1', 'A', 'W', 'A'), r1('2', 'B', 'C', 'B'), r1('3', 'D', 'E', 'D')],
    });
    const ctx = (await swissContext(T))!;
    const { round } = swissPairRound(ctx, 2);
    const oppOfA = round.pairs.map((p: any) => [p.white ?? p.a, p.black ?? p.b]).find(([x, y]) => x === 'A' || y === 'A');
    const opp = oppOfA ? (oppOfA[0] === 'A' ? oppOfA[1] : oppOfA[0]) : round.bye === 'A' ? 'bye' : null;
    expect(['B', 'D']).toContain(opp);
  });
});
