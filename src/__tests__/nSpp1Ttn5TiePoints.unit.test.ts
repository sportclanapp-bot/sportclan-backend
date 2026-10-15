/** N-SPP1-TTN-5 (launch test plan, Round 3): in a team-tie tournament 'Points difference' listed every team at 0 (0–0); its table shows 99–63. */
import { sportBoards } from '../utils/sportLeaders';

const tie = {
  id: 'm1', team_a_id: 'D', team_b_id: 'P', winner_team_id: 'D',
  score_summary: { A: { sets: [11, 11, 11, 11, 11, 11, 11, 11, 11], score: 3 }, B: { sets: [5, 7, 9, 5, 7, 9, 5, 7, 9], score: 0 }, rubbers: [{ key: 'A v X', A: 3, B: 0 }], tie: { decided: 'A' } },
} as never;
test('a tie’s points and games count, as in its table', () => {
  const boards = sportBoards('tabletennis', [tie], { D: 'Deccan', P: 'PYC' });
  const diff = boards.find((b) => b.title === 'Points difference')!;
  expect(diff.rows.map((r) => [r.name, r.value, r.detail])).toEqual([['Deccan', 36, '99–63'], ['PYC', -36, '63–99']]);
  expect(boards.find((b) => b.title === 'Games won')!.rows.map((r) => [r.name, r.value])).toEqual([['Deccan', 9]]);
});
