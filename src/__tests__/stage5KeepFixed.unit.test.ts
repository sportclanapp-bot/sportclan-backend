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

test('5.3 · DLS answers as it did before the build', () => {
  expect(calculateDLSTarget(150, 20, 10, 3)).toEqual({ revisedTarget: 74, resourcesTeam1: 55.8, resourcesTeam2: 26.81, method: 'DLS' });
  expect(calculateDLSTarget(150, 20, 20, 0).revisedTarget).toBe(151); // no interruption, no change
  expect(calculateDLSTarget(200, 50, 25, 5)).toEqual({ revisedTarget: 88, resourcesTeam1: 87.01, resourcesTeam2: 37.74, method: 'DLS' });
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
