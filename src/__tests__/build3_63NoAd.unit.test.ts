/** BUILD 3.63 · no-ad and semi-ad games — the server counts them the same way. */
import { tennisReplay } from '../utils/tennisCore';
import { standardRules, tennisOptsOf } from '../utils/matchRules';

test('the deciding point', () => {
  const deuce = ['A', 'B', 'A', 'B', 'A', 'B'] as Array<'A' | 'B'>;
  const noad = tennisReplay([...deuce, 'B'], tennisOptsOf({ ...standardRules('tennis'), adScoring: 'noad' }));
  expect([noad.games.A, noad.games.B]).toEqual([0, 1]);
  const semi = tennisReplay([...deuce, 'A', 'B', 'A'], tennisOptsOf({ ...standardRules('tennis'), adScoring: 'semiad' }));
  expect([semi.games.A, semi.games.B]).toEqual([1, 0]);
  const ad = tennisReplay([...deuce, 'B'], tennisOptsOf(standardRules('tennis')));
  expect([ad.games.B, ad.points.B]).toEqual([0, 4]);
});
