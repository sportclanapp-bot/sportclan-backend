/**
 * BUILD 3.17 · football periods 1–4, 5–45 minutes each, half-time 0–20
 * (display). Commentary says "Half-time" only between two halves.
 */
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';
import { sportCommentary } from '../utils/commentary';

const fb = (x: object) => rulesRefusal('football', { ...standardRules('football'), ...x });

test('periods, length and half-time', () => {
  expect(standardRules('football')).toMatchObject({ periods: 2, periodMinutes: null, halfTimeMinutes: null });
  for (const ok of [{ periods: 1 }, { periods: 4 }, { periodMinutes: 5 }, { periodMinutes: 45 }, { halfTimeMinutes: 0 }, { halfTimeMinutes: 20 }]) expect(fb(ok)).toBeNull();
  expect(fb({ periods: 5 })?.field).toBe('periods');
  expect(fb({ periods: 0 })?.field).toBe('periods');
  expect(fb({ periodMinutes: 4 })?.error).toBe('A period must be off, or 5 to 45 minutes.');
  expect(fb({ periodMinutes: 46 })?.field).toBe('periodMinutes');
  expect(fb({ halfTimeMinutes: 21 })?.error).toBe('Half-time must be off, or 0 to 20 minutes.');
});
test('basketball periods stay fixed until 3.30 (hockey opened in 3.25)', () => {
  expect(rulesRefusal('hockey', { ...standardRules('hockey'), periods: 2 })).toBeNull();
  expect(rulesRefusal('basketball', { ...standardRules('basketball'), periodMinutes: 10 })?.field).toBe('periodMinutes');
  expect(rulesRefusal('hockey', { ...standardRules('hockey'), halfTimeMinutes: 5 })?.field).toBe('halfTimeMinutes');
});
test('the label: "7-a-side · 2 × 25 min · HT 10 min"', () => {
  expect(timedRulesLabel('football', { ...standardRules('football'), players: 7, periodMinutes: 25, halfTimeMinutes: 10 })).toBe('7-a-side · 2 × 25 min · HT 10 min');
});
test('commentary: Half-time between two halves, else the period that ended', () => {
  const ctx = (regulation: number | null, period: number) => ({ sport: 'football', teamA: 'A', teamB: 'B', period, regulation });
  expect(sportCommentary('period_change', { kind: 'halftime' }, ctx(2, 1))).toBe('Half-time');
  expect(sportCommentary('period_change', {}, ctx(null, 1))).toBe('Half-time'); // an older match: two halves
  expect(sportCommentary('period_change', { kind: 'period' }, ctx(4, 2))).toBe('End of period 2');
  expect(sportCommentary('period_change', { kind: 'quarter' }, { sport: 'hockey', teamA: 'A', teamB: 'B', period: 3, regulation: 4 })).toBe('End of Q3');
});
