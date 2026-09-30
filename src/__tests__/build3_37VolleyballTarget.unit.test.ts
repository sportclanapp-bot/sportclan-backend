/**
 * BUILD 3.37 · volleyball points a set, 10–30 (standard 25). The server's set
 * rollup takes the match's target (setConfigOf), as the app's engine does.
 */
import { rulesRefusal, standardRules, setConfigOf, timedRulesLabel } from '../utils/matchRules';
import { rollupSets } from '../controllers/scoring.controller';

test('10–30; standard 25; the label says a change', () => {
  const r = (target: unknown) => rulesRefusal('volleyball', { ...standardRules('volleyball'), target });
  for (const ok of [10, 21, 30]) expect(r(ok)).toBeNull();
  for (const bad of [9, 31, 20.5]) expect(r(bad)?.error).toBe('Points to win a set must be 10 to 30.');
  expect(timedRulesLabel('volleyball', { ...standardRules('volleyball'), target: 21 })).toBe('sets to 21');
  expect(timedRulesLabel('volleyball', standardRules('volleyball'))).toBeNull();
  expect(rulesRefusal('carrom', { ...standardRules('carrom'), target: 29 })?.field).toBe('target'); // the rally sports' targets opened 3.44–3.55; carrom's is 3.72
});
test('a set to 15 ends at 15 (2 clear)', () => {
  const pts = (side: string, n: number) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, value: 1 } }));
  const cfg = setConfigOf({ ...standardRules('volleyball'), target: 15 });
  const r = rollupSets(cfg, [...pts('A', 15), ...pts('B', 3)], (p) => (p.team_side === 'B' ? 'B' : 'A'));
  expect(r.setsA).toBe(1);
  expect(r.setScoresA[0]).toBe(15);
});
