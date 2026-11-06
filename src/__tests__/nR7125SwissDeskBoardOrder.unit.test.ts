/**
 * N-R7-125 (SP-CHS-135, 6 Nov 2026): the Pairings desk listed the current round's boards in
 * the database's row order, not the games' board numbers. swissContext selected the Swiss
 * games with no ORDER BY, and getSwiss builds `current.boards` from that list, so an 8-player
 * round 1 drawn 1v5, 6v2, 3v7, 8v4 (match_no 0–3) read 1v5, 3v7, 8v4, 6v2 on the desk.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { swissContext } from '../controllers/tournaments.controller';

const T = 't125';
const g = (id: string, round: number, no: number, a: string, b: string | null) => ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: null, status: 'scheduled', voided_at: null, bracket: null, round, match_no: no, score_summary: {}, scheduled_at: null, overs: null });
test('the Swiss games come back by round, then board (match_no), whatever the row order', async () => {
  const ids = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
  db = fakeDb({
    sports: [{ id: 's-ch', slug: 'chess' }],
    tournaments: [{ id: T, name: 'Swiss 8', sport_id: 's-ch', format: 'swiss', settings: { swiss: { rounds: 4, tpn: ids, paired: 1 } }, tiebreaker_rules: [] }],
    tournament_entries: ids.map((x) => ({ tournament_id: T, team_id: x, status: 'approved', team: { name: x } })),
    // ids as in the SP-CHS-135 run: id order (allRows pages by id) is not board order
    matches: [g('13ea', 1, 0, 'P1', 'P5'), g('83e9', 1, 2, 'P3', 'P7'), g('90ac', 1, 3, 'P8', 'P4'), g('b77f', 1, 1, 'P6', 'P2')],
  });
  const ctx = (await swissContext(T))!;
  const boards = ctx.ms.filter((m: any) => Number(m.round) === 1).map((m: any) => `${m.team_a_id}v${m.team_b_id}`);
  expect(boards).toEqual(['P1vP5', 'P6vP2', 'P3vP7', 'P8vP4']);
});
