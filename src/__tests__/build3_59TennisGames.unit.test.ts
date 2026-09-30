/** BUILD 3.59 · tennis games a set — the server replays with the match's rules. */
import { tennisReplay } from '../utils/tennisCore';
import { rulesRefusal, standardRules, tennisOptsOf } from '../utils/matchRules';

const games = (s: 'A' | 'B', n: number) => Array.from({ length: 4 * n }, () => s);

test('short sets and a pro set', () => {
  expect(tennisReplay(games('A', 4), tennisOptsOf({ ...standardRules('tennis'), gamesPerSet: 4 })).sets).toEqual([{ A: 4, B: 0 }]);
  expect(tennisReplay(games('A', 6), tennisOptsOf({ ...standardRules('tennis'), bestOf: 1, gamesPerSet: 8 })).winner).toBeNull();
  expect(rulesRefusal('tennis', { ...standardRules('tennis'), gamesPerSet: 10 })).toBeNull();
});
test('the summary reads the match’s rules', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const src: string = require('fs').readFileSync(require('path').join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain("tennisOptsOf(rulesOf('tennis', match)), // BUILD 2.3 / 3.59+: the match's rules");
});
