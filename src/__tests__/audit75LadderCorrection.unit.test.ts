/**
 * Audit #75 (11 Oct 2026): a corrected ladder result didn't move players back.
 * Ladder A B C D E (leapfrog). E challenges C and the win is recorded: A B E C D.
 * Then B challenges A and wins: B A E C D. The organiser corrects E–C (C won):
 * the ladder must read B A C D E — E back where it was, B's later move kept.
 * Voiding B–A then puts A back on top: A B C D E.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { ladderAfterResult, ladderOrder, recrownAfterVoidChange } from '../controllers/tournaments.controller';

const order = async () => (await ladderOrder('T')).map((r) => r.team_id).join(' ');
const decide = async (id: string, winner: string) => {
  const m = db.t('matches').find((x) => x.id === id)!;
  m.winner_team_id = winner; m.status = 'completed';
  await ladderAfterResult({ id, tournament_id: 'T', team_a_id: m.team_a_id, team_b_id: m.team_b_id, winner_team_id: winner });
};

test('a corrected result and a void put the ladder right; later moves are kept', async () => {
  db = fakeDb({
    tournaments: [{ id: 'T', format: 'ladder', status: 'live', settings: { ladder: { move: 'leapfrog' } } }],
    tournament_entries: ['A', 'B', 'C', 'D', 'E'].map((x, i) => ({ id: `e${x}`, tournament_id: 'T', team_id: x, seed: i + 1, status: 'approved', entered_at: '2026-10-01T00:00:00Z', team: { name: x } })),
    matches: [
      { id: 'ec', tournament_id: 'T', team_a_id: 'E', team_b_id: 'C', winner_team_id: null, status: 'scheduled', voided_at: null, score_summary: {}, group_label: null, next_match_id: null, bracket: null },
      { id: 'ba', tournament_id: 'T', team_a_id: 'B', team_b_id: 'A', winner_team_id: null, status: 'scheduled', voided_at: null, score_summary: {}, group_label: null, next_match_id: null, bracket: null },
    ],
  });
  await decide('ec', 'E');
  expect(await order()).toBe('A B E C D');
  await new Promise((r) => setTimeout(r, 5));
  await decide('ba', 'B');
  expect(await order()).toBe('B A E C D');
  await decide('ec', 'C'); // the correction
  expect(await order()).toBe('B A C D E');
  db.t('matches').find((x) => x.id === 'ba')!.voided_at = '2026-10-11T00:00:00Z';
  await recrownAfterVoidChange('ba');
  expect(await order()).toBe('A B C D E');
});
