/** BUILD 3.31 · basketball overtime 1–5 minutes (standard 5), display only. */
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test('1 or more (Stage 13 · CR3: no top); standard 5; the label says a change', () => {
  expect(standardRules('basketball').overtimeMinutes).toBe(5);
  for (const ok of [1, 3, 5, 6, 10]) expect(rulesRefusal('basketball', { ...standardRules('basketball'), overtimeMinutes: ok })).toBeNull();
  for (const bad of [0, -1, 2.5]) expect(rulesRefusal('basketball', { ...standardRules('basketball'), overtimeMinutes: bad })?.error).toBe('Overtime must be 1 minute or more.');
  expect(timedRulesLabel('basketball', { ...standardRules('basketball'), overtimeMinutes: 3 })).toBe('OT 3 min');
});
