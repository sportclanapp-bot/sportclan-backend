/** Audit #70 (11 Oct 2026): a team record counted a walkover by completion but not one by withdrawal, and counted a Swiss bye as a win. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { computeTeamRecord } from '../utils/teamRecord';

test('walkovers counted alike; a bye and a no-result are not matches', async () => {
  const m = (id: string, b: string | null, w: string | null, status: string) => ({ id, team_a_id: 'T', team_b_id: b, winner_team_id: w, status, voided_at: null });
  db = fakeDb({ matches: [
    m('played', 'X', 'T', 'completed'),
    m('woComplete', 'X', 'T', 'completed'),
    m('woWithdrawal', 'Y', 'T', 'abandoned'),
    m('bye', null, 'T', 'completed'),
    m('bye2', null, 'T', 'completed'),
    m('noResult', 'Z', null, 'abandoned'),
    m('lost', 'Z', 'Z', 'completed'),
  ] });
  expect(await computeTeamRecord('T')).toEqual({ played: 4, wins: 3, losses: 1, draws: 0, win_rate: 75 });
});
