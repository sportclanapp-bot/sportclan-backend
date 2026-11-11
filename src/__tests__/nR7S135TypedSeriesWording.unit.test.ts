// N-R7-S135 (Step 2 B11 B16, SPP2-VOL-035): a typed volleyball series result with a game after the series
// was won said the team-tie words 'The tie was decided before Game 5.'; a series says
// 'Game 5 isn’t played — the series was already won.' (as typedSeriesPoints does).
import { typedTiePoints } from '../utils/typedScore';
import { standardRules, type MatchRules } from '../utils/matchRules';
import { seriesSpec } from '../utils/tieCore';

const W = [{ a: 25, b: 20 }, { a: 25, b: 20 }];
const L = [{ a: 20, b: 25 }, { a: 20, b: 25 }];
const rules = { ...standardRules('volleyball'), bestOf: 3, tie: seriesSpec(5) } as MatchRules;

test('a series game after the series was won is refused in series words', () => {
  expect(typedTiePoints('volleyball', rules, seriesSpec(5), [W, L, W, W, W]).problem).toBe('Game 5 isn’t played — the series was already won.');
});

test('a team tie keeps its own words', () => {
  const tie = { rubbers: [1, 2, 3].map((n) => ({ key: `R${n}`, label: `Match ${n}`, players: 1 })), win: 'first' } as never;
  expect(typedTiePoints('volleyball', rules, tie, [W, W, W]).problem).toBe('The tie was decided before Match 3.');
});
