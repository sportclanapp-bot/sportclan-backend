/**
 * F143 (launch test plan, Round 2): the DLS calculator assumed 10 wickets a side — a 6-a-side
 * chase on its last wicket was charged like an 11-a-side one 4 down, and a 15-a-side chase 10 down
 * was 'all out'. Wickets are now read against the side's own all-out (players − 1, + 1 with last
 * man stands): the same share of the table. 11-a-side is unchanged.
 */
import { calculateDLSTarget, dlsInputProblem } from '../utils/dls';

test('11-a-side (all out at 10): unchanged', () => {
  expect(calculateDLSTarget(150, 20, 6, 3, 10)).toEqual(calculateDLSTarget(150, 20, 6, 3, 10, 10));
  expect(calculateDLSTarget(150, 20, 6, 3, 10).revisedTarget).toBe(126);
});
test('6-a-side on its last wicket (4 of 5 down) is charged like 11-a-side on its last (8 of 10)', () => {
  const six = calculateDLSTarget(80, 10, 3, 4, 5, 5);
  const eleven = calculateDLSTarget(80, 10, 3, 8, 5, 10);
  expect(six.revisedTarget).toBe(eleven.revisedTarget);
  expect(six.revisedTarget).not.toBe(calculateDLSTarget(80, 10, 3, 4, 5).revisedTarget); // the old 10-wicket reading
});
test('15-a-side: 10 down is not all out (14 is); between whole shares the table is read between its rows', () => {
  expect(dlsInputProblem({ team1Score: 200, totalOvers: 20, team2OversLeft: 5, team2Wickets: 10, team2OversFaced: 10, allOut: 14 })).toBeNull();
  expect(dlsInputProblem({ team1Score: 200, totalOvers: 20, team2OversLeft: 5, team2Wickets: 14, team2OversFaced: 10, allOut: 14 })).toMatch(/all out/);
  expect(dlsInputProblem({ team1Score: 200, totalOvers: 20, team2OversLeft: 5, team2Wickets: 15, team2OversFaced: 10, allOut: 14 })).toBe('Wickets lost is between 0 and 14.');
  const t = (w: number) => calculateDLSTarget(200, 20, 5, w, 10, 14).revisedTarget;
  expect(t(7)).toBeGreaterThanOrEqual(t(6));
  expect(t(8)).toBeGreaterThanOrEqual(t(7));
});
