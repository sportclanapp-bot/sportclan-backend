/**
 * BUILD 3.19 · a level knockout: extra time (0–15 min a half; 0 = straight to
 * penalties), then penalties. Commentary and the edit log name extra time.
 */
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';
import { sportCommentary } from '../utils/commentary';
import { describeEvent } from '../utils/editLog';

test('extra time: off or any whole minutes a half (Stage 13 · CR3: no top); standard off', () => {
  const r = (extraTimeMinutes: unknown) => rulesRefusal('football', { ...standardRules('football'), extraTimeMinutes });
  expect(standardRules('football').extraTimeMinutes).toBe(0);
  for (const ok of [0, 5, 15, 16, 60]) expect(r(ok)).toBeNull();
  for (const bad of [-1, 7.5, null]) expect(r(bad)?.error).toBe('Extra time must be off, or a whole number of minutes a half.');
  expect(timedRulesLabel('football', { ...standardRules('football'), extraTimeMinutes: 10 })).toBe('ET 2 × 10 min');
  expect(rulesRefusal('hockey', { ...standardRules('hockey'), extraTimeMinutes: 5 })?.field).toBe('extraTimeMinutes');
});
test('commentary and the edit log', () => {
  const ctx = { sport: 'football', teamA: 'A', teamB: 'B', period: 2, regulation: 2 };
  expect(sportCommentary('period_change', { kind: 'extra_time' }, ctx)).toBe('Extra time');
  expect(sportCommentary('period_change', { kind: 'et_half' }, ctx)).toBe('Extra time · half-time');
  const log = { sport: 'football', teamA: 'A', teamB: 'B' };
  expect(describeEvent('period_change', { kind: 'extra_time' }, log)).toContain('extra time');
  expect(describeEvent('period_change', { kind: 'et_half' }, log)).toContain('extra-time half-time');
});
