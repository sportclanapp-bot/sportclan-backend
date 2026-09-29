/** BUILD 3.38 · volleyball's deciding set, 10–25 (standard 15); the server rollup plays to it. */
import { rulesRefusal, standardRules, setConfigOf, timedRulesLabel } from '../utils/matchRules';
import { rollupSets } from '../controllers/scoring.controller';

test('10–25 or the same; the label says a change', () => {
  const r = (finalTarget: unknown) => rulesRefusal('volleyball', { ...standardRules('volleyball'), finalTarget });
  for (const ok of [null, 10, 25]) expect(r(ok)).toBeNull();
  for (const bad of [9, 26, 12.5]) expect(r(bad)?.error).toBe('The deciding set must be 10 to 25 points.');
  expect(timedRulesLabel('volleyball', { ...standardRules('volleyball'), finalTarget: 25 })).toBe('decider to 25');
  expect(timedRulesLabel('volleyball', { ...standardRules('volleyball'), bestOf: 3, target: 21, finalTarget: 15 })).toBe('sets to 21');
});
test('a best-of-3 with a decider to 11: the third set ends at 11', () => {
  const pts = (side: string, n: number) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, value: 1 } }));
  const cfg = setConfigOf({ ...standardRules('volleyball'), bestOf: 3, finalTarget: 11 });
  const r = rollupSets(cfg, [...pts('A', 25), ...pts('B', 25), ...pts('A', 11)], (p) => (p.team_side === 'B' ? 'B' : 'A'));
  expect(r.decided).toBe('A');
});
