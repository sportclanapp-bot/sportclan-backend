/** BUILD 3.24 · football sin bin: off, or 2–15 minutes (display only). */
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test('off or 2–15; the label', () => {
  const r = (sinBinMinutes: unknown) => rulesRefusal('football', { ...standardRules('football'), sinBinMinutes });
  expect(standardRules('football').sinBinMinutes).toBeNull();
  for (const ok of [null, 2, 10, 15]) expect(r(ok)).toBeNull();
  for (const bad of [1, 16, 2.5]) expect(r(bad)?.error).toBe('A sin bin must be off, or 2 to 15 minutes.');
  expect(timedRulesLabel('football', { ...standardRules('football'), sinBinMinutes: 10 })).toBe('sin bin 10 min');
});
