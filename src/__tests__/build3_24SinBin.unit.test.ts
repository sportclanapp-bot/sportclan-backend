/** BUILD 3.24 · football sin bin: off, or 2–15 minutes (display only). */
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test('off or 1 minute or more (Stage 13 · CR3: no top); the label', () => {
  const r = (sinBinMinutes: unknown) => rulesRefusal('football', { ...standardRules('football'), sinBinMinutes });
  expect(standardRules('football').sinBinMinutes).toBeNull();
  for (const ok of [null, 1, 2, 10, 15, 16, 30]) expect(r(ok)).toBeNull();
  for (const bad of [0, -1, 2.5]) expect(r(bad)?.error).toBe('A sin bin must be off, or a whole number of minutes.');
  expect(timedRulesLabel('football', { ...standardRules('football'), sinBinMinutes: 10 })).toBe('sin bin 10 min');
});
