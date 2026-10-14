/**
 * F160 (launch test plan, Round 1) · the "FIVB (wins, set ratio)" table order ranked
 * by match points first: its list had no match points, so the standard put points
 * at the top, and a team with more wins could sit below one with fewer.
 */
import { rankTeams, buildOrder } from '../utils/standings';
import { tiebreakPresetsFor } from '../utils/tournamentSettings';

const vb = (id: string, a: string, b: string, sets: Array<[number, number]>) => {
  const sa = sets.filter(([x, y]) => x > y).length; const sb = sets.length - sa;
  return { id, team_a_id: a, team_b_id: b, winner_team_id: sa > sb ? a : b, status: 'completed', score_summary: { A: { score: sa, sets: sets.map((s) => s[0]) }, B: { score: sb, sets: sets.map((s) => s[1]) } } } as any;
};
const won = (n: number, lost = 0): Array<[number, number]> => [...Array.from({ length: lost }, () => [20, 25] as [number, number]), ...Array.from({ length: n }, () => [25, 20] as [number, number])];
const FIVB_POINTS = { win: 3, draw: 1.5, loss: 0, noResult: null, walkoverWin: null, walkoverLoss: null, sets: { straight: [3, 0], decider: [2, 1] } } as never;
// X wins three, all 3-2 (6 points); Y wins two 3-0 and loses 2-3 to X (7 points).
const m = [vb('1', 'X', 'Z', won(3, 2)), vb('2', 'X', 'W', won(3, 2)), vb('3', 'X', 'Y', won(3, 2)), vb('4', 'Y', 'Z', won(3)), vb('5', 'Y', 'W', won(3))];

it('the FIVB preset ranks matches won first (X, 3 wins, above Y, 2 wins)', () => {
  const fivb = tiebreakPresetsFor('volleyball').find((p) => p.key === 'fivb')!;
  expect(rankTeams(['X', 'Y', 'Z', 'W'], m, fivb.order, FIVB_POINTS).slice(0, 2)).toEqual(['X', 'Y']);
});
it('a tournament saved with the old FIVB list (no match points) ranks wins first too', () => {
  expect(buildOrder(['wins', 'score_ratio', 'head_to_head'])).toEqual(['wins', 'points', 'score_ratio', 'head_to_head']);
  expect(rankTeams(['X', 'Y', 'Z', 'W'], m, ['wins', 'score_ratio', 'head_to_head'], FIVB_POINTS).slice(0, 2)).toEqual(['X', 'Y']);
});
it('lists that don’t start with wins keep points first (the standard)', () => {
  expect(buildOrder(['head_to_head'])).toEqual(['points', 'head_to_head']);
  expect(buildOrder(undefined)[0]).toBe('points');
});
