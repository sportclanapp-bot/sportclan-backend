/**
 * Audit #61 (11 Oct 2026): leaderboards counted no-result matches — an
 * abandoned 0–0 gave both sides a clean sheet, and goals from an abandoned game
 * went on the scorers' board.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { loadLeaders } from '../controllers/features.controller';

describe('audit #61', () => {
  it('an abandoned match gives no clean sheet and no goals', async () => {
    const m = (id: string, status: string, w: string | null, ss: object) => ({ id, tournament_id: 'T', team_a_id: 'X', team_b_id: 'Y', winner_team_id: w, status, result_type: null, voided_at: null, score_summary: ss });
    db = fakeDb({
      sports: [{ id: 's-fb', slug: 'football' }],
      tournaments: [{ id: 'T', sport_id: 's-fb' }],
      teams: [{ id: 'X', name: 'X' }, { id: 'Y', name: 'Y' }],
      users: [{ id: 'u1', name: 'Una' }, { id: 'u2', name: 'Vic' }],
      matches: [
        m('played', 'completed', 'X', { A: { score: 1 }, B: { score: 0 }, players: { u1: { goals: 1 } } }),
        m('noresult', 'abandoned', null, { A: { score: 0 }, B: { score: 0 }, players: {} }),
        m('abandonedWon', 'abandoned', 'Y', { A: { score: 0 }, B: { score: 3 }, players: { u2: { goals: 3 } } }),
      ],
    });
    const r = (await loadLeaders('T'))!;
    const cs = r.boards.find((b) => b.stat === 'clean_sheets')!;
    const csOf = (id: string) => cs.rows.find((x: any) => x.id === id || x.team_id === id || x.teamId === id)?.value ?? 0;
    expect(csOf('X')).toBe(1);
    expect(csOf('Y')).toBe(0);
    const goals = r.boards.find((b) => b.stat === 'goals')!;
    expect(goals.rows.map((x: any) => x.value)).toEqual([1]);
  });
});
