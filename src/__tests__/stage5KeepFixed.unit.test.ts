/**
 * Stage 5 · the keep-fixed check, server side. DLS is pinned to its current
 * answers (the calculator hasn't changed since the build began — no commits to
 * utils/dls.ts after bf4a85f), and the server's copies of the shared rules
 * are held to the same fixed points as the app's (stage5KeepFixed.test.ts).
 */
import { calculateDLSTarget, dlsInputProblem } from '../utils/dls';
import { rulesRefusal, standardRules } from '../utils/matchRules';
import { inningsFinished } from '../utils/cricketRules';
import { tennisReplay } from '../utils/tennisCore';
import { carromBoard, emptyCarrom } from '../utils/carromCore';

test('5.3 · DLS answers, pinned (re-pinned 14 Oct 2026 for F138: the chase is charged only the overs the rain took)', () => {
  // F138: the old pins (74, 88) were the bug — they charged Team 2 as if it had batted nothing.
  expect(calculateDLSTarget(150, 20, 10, 3, 10)).toEqual({ revisedTarget: 151, resourcesTeam1: 55.8, resourcesTeam2: 55.8, method: 'DLS' }); // 10 batted, none lost
  expect(calculateDLSTarget(150, 20, 6, 3, 10)).toEqual({ revisedTarget: 126, resourcesTeam1: 55.8, resourcesTeam2: 46.37, method: 'DLS' }); // 4 overs lost
  expect(calculateDLSTarget(150, 20, 20, 0).revisedTarget).toBe(151); // no interruption, no change
  expect(calculateDLSTarget(150, 20, 12, 0, 0)).toEqual({ revisedTarget: 106, resourcesTeam1: 55.8, resourcesTeam2: 38.73, method: 'DLS' }); // cut to 12 before the chase
  expect(calculateDLSTarget(200, 50, 15, 5, 25)).toEqual({ revisedTarget: 177, resourcesTeam1: 87.01, resourcesTeam2: 76.29, method: 'DLS' });
  expect(dlsInputProblem({ team1Score: 0, totalOvers: 0, team2OversLeft: 0, team2Wickets: 0 } as never)).not.toBeNull();
});

test('5.1 / 5.2 · cricket: 6 balls an over and one innings a side are not settings', () => {
  expect(rulesRefusal('cricket', { v: 1, ballsPerOver: 8 } as never)).not.toBeNull();
  expect(rulesRefusal('cricket', { v: 1, innings: 2 } as never)).not.toBeNull();
  expect(inningsFinished({ runs: 1, wickets: 0, balls: 29 } as never, 5, 10)).toBe(false);
  expect(inningsFinished({ runs: 1, wickets: 0, balls: 30 } as never, 5, 10)).toBe(true);
});

test('5.5 / 5.8 · basketball has no draws; chess has no best-of', () => {
  expect(standardRules('basketball')).toMatchObject({ drawAllowed: false });
  expect(rulesRefusal('basketball', { v: 1, drawAllowed: true } as never)).not.toBeNull();
  expect(rulesRefusal('chess', { v: 1, bestOf: 3 } as never)).not.toBeNull();
});

test('5.7 · tennis: 4 points a game, deuce needs two clear', () => {
  expect(tennisReplay(['A', 'A', 'A', 'A']).games).toEqual({ A: 1, B: 0 });
  expect(tennisReplay(['A', 'B', 'A', 'B', 'A', 'B', 'A']).games).toEqual({ A: 0, B: 0 });
});

test('5.9 · carrom: the queen only for the board’s winner', () => {
  const covered = carromBoard(emptyCarrom(), { winner: 'A', piecesLeft: 4, queen: true }, 1);
  const notCovered = carromBoard(emptyCarrom(), { winner: 'A', piecesLeft: 4, queen: false }, 1);
  expect(covered.points.A - notCovered.points.A).toBe(standardRules('carrom').queenPoints);
  expect(covered.points.B).toBe(0);
});
