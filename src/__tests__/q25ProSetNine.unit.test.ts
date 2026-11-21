/**
 * Q25 (Dipak, 21 Nov 2026): a tennis pro set to 9 has its tiebreak at 8-all and ends 9–8 — the
 * server's own replay (result, standings) and its typed-score check agree with the pad.
 */
import { tennisReplay } from '../utils/tennisCore';
import { standardRules, tennisOptsOf, TENNIS_PRESETS, timedRulesLabel, type MatchRules } from '../utils/matchRules';
import { typedMatchPoints } from '../utils/typedScore';

type S = 'A' | 'B';
const games = (s: S, n: number): S[] => Array.from({ length: 4 * n }, () => s);
const toAll = (n: number): S[] => Array.from({ length: n }, () => [...games('A', 1), ...games('B', 1)]).flat();
const pro9 = TENNIS_PRESETS.find((p) => p.value === 'pro9')!.rules as Partial<MatchRules>;
const opts = tennisOptsOf({ ...standardRules('tennis'), ...pro9 } as MatchRules);

test('the tiebreak comes at 8-all and the set ends 9–8', () => {
  expect(tennisReplay(toAll(8), opts).tiebreak).toBe(true);
  const done = tennisReplay([...toAll(8), ...Array<S>(7).fill('A')], opts);
  expect(done.winner).toBe('A');
  expect(done.sets[0]).toMatchObject({ A: 9, B: 8 });
});

test('a pro set to 8 keeps its tiebreak at 8-all (ends 9–8 too)', () => {
  const pro8 = tennisOptsOf({ ...standardRules('tennis'), bestOf: 1, gamesPerSet: 8 } as MatchRules);
  expect(tennisReplay(toAll(8), pro8).tiebreak).toBe(true);
  expect(tennisReplay(toAll(7), pro8).tiebreak).toBe(false);
});

test('typed: 9–8 (7–4) is finished, 10–9 is refused; the rules line says 8–8', () => {
  expect(typedMatchPoints('tennis', pro9, [{ a: 9, b: 8, tbA: 7, tbB: 4 }]).winner).toBe('A');
  expect(typedMatchPoints('tennis', pro9, [{ a: 10, b: 9, tbA: 7, tbB: 4 }]).problem).toMatch(/isn’t a finished set/);
  expect(timedRulesLabel('tennis', pro9 as MatchRules)).toMatch(/pro set to 9 · tiebreak at 8–8/);
});
