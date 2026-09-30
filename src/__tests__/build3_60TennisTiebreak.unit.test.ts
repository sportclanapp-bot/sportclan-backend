/** BUILD 3.60 · advantage sets — the server plays on past 6-6 too. */
import { tennisReplay } from '../utils/tennisCore';
import { standardRules, tennisOptsOf } from '../utils/matchRules';

test('8-6 in an advantage set', () => {
  const g = (s: 'A' | 'B', n: number) => Array.from({ length: 4 * n }, () => s);
  const pts = [...g('A', 5), ...g('B', 5), ...g('A', 1), ...g('B', 1), ...g('A', 2)];
  expect(tennisReplay(pts, tennisOptsOf({ ...standardRules('tennis'), tiebreak: false })).sets).toEqual([{ A: 8, B: 6 }]);
  expect(tennisReplay(pts, tennisOptsOf(standardRules('tennis'))).sets[0]?.tiebreak).toBeDefined(); // standard: a tiebreak
});
