/** Audit #65 (11 Oct 2026): knockout placings and awards missed a final won by walkover (abandoned with a winner). */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import * as awards from '../controllers/awards.controller';

const ko = (id: string, round: number, a: string, b: string, w: string | null, status: string, extra: object = {}) =>
  ({ id, tournament_id: 'T', team_a_id: a, team_b_id: b, team_a_name: a, team_b_name: b, winner_team_id: w, status, round, group_label: null, third_place: false, voided_at: null, score_summary: {}, bracket: null, ...extra });

describe('audit #65', () => {
  it('a final won by walkover still crowns the winner and the runner-up', async () => {
    db = fakeDb({ matches: [
      ko('s1', 1, 'A', 'B', 'A', 'completed'), ko('s2', 1, 'C', 'D', 'C', 'completed'),
      ko('f', 2, 'A', 'C', 'C', 'abandoned', { score_summary: { walkover: true } }),
    ] });
    const p = await (awards as any).placingsFor({ id: 'T', format: 'knockout', status: 'completed', sport_id: null });
    expect(p.slice(0, 2).map((x: any) => [x.place, x.team_id])).toEqual([[1, 'C'], [2, 'A']]);
  });
});
