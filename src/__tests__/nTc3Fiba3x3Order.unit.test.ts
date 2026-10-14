/** N-TC-3 (launch test plan, Round 2): the server's FIBA 3x3 order ranks by win ratio first (fixed with F160 in Round 1; pinned here). */
import { rankTeams, buildOrder } from '../utils/standings';
import { tiebreakPresetsFor } from '../utils/tournamentSettings';

const g = (id: string, a: string, b: string, sa: number, sb: number) => ({ id, team_a_id: a, team_b_id: b, winner_team_id: sa > sb ? a : b, status: 'completed', score_summary: { A: { score: sa }, B: { score: sb } } } as any);
const BB_POINTS = { win: 2, draw: 1, loss: 1, noResult: null, walkoverWin: null, walkoverLoss: null } as never;
const m = [g('1', 'X', 'Z', 21, 15), g('2', 'X', 'W', 21, 18), g('3', 'X', 'V', 15, 21), g('4', 'Y', 'Z', 21, 10), g('5', 'Y', 'W', 21, 12)];

test('FIBA 3x3: win ratio first — Y and V (unbeaten) above X (2-1, more points)', () => {
  const p = tiebreakPresetsFor('basketball').find((x) => /3x3/i.test(x.label))!;
  expect(buildOrder(p.order)[0]).toBe('win_ratio');
  expect(rankTeams(['X', 'Y', 'Z', 'W', 'V'], m, p.order, BB_POINTS).slice(0, 3)).toEqual(['Y', 'V', 'X']);
});
