/** BUILD 3.61 · a 10-point tiebreak — the server counts it the same way. */
import { tennisReplay } from '../utils/tennisCore';
import { standardRules, tennisOptsOf } from '../utils/matchRules';

test('10-8 in a tiebreak to 10', () => {
  const g = (s: 'A' | 'B', n: number) => Array.from({ length: n }, () => s);
  const sixAll = [...g('A', 20), ...g('B', 20), ...g('A', 4), ...g('B', 4)];
  const tb = [...g('A', 8), ...g('B', 8), ...g('A', 2)];
  expect(tennisReplay([...sixAll, ...tb], tennisOptsOf({ ...standardRules('tennis'), tiebreakTo: 10 })).sets).toEqual([{ A: 7, B: 6, tiebreak: { A: 10, B: 8 } }]);
});
