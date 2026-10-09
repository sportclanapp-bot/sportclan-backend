/**
 * BUILD 3.17 · football periods 1–4, 5–45 minutes each, half-time 0–20
 * (display). Commentary says "Half-time" only between two halves.
 */
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';
import { sportCommentary } from '../utils/commentary';

const fb = (x: object) => rulesRefusal('football', { ...standardRules('football'), ...x });

test('periods, length and half-time', () => {
  expect(standardRules('football')).toMatchObject({ periods: 2, periodMinutes: null, halfTimeMinutes: null });
  // Stage 13 · CR3: no tops — the old tops (4 periods, 45 min, half-time 20) and above are fine.
  for (const ok of [{ periods: 1 }, { periods: 4 }, { periods: 5 }, { periodMinutes: 1 }, { periodMinutes: 4 }, { periodMinutes: 45 }, { periodMinutes: 46 }, { periodMinutes: 90 }, { halfTimeMinutes: 0 }, { halfTimeMinutes: 20 }, { halfTimeMinutes: 21 }]) expect(fb(ok)).toBeNull();
  expect(fb({ periods: 0 })?.error).toBe('Periods must be a whole number, 1 or more.');
  expect(fb({ periods: 2.5 })?.field).toBe('periods');
  expect(fb({ periodMinutes: 0 })?.error).toBe('A period must be off, or a whole number of minutes.');
  expect(fb({ periodMinutes: 12.5 })?.field).toBe('periodMinutes');
  expect(fb({ halfTimeMinutes: -1 })?.error).toBe('Half-time must be off, or a whole number of minutes.');
});
test('hockey (3.25) and basketball (3.30) periods are open; half-time stays football’s', () => {
  expect(rulesRefusal('hockey', { ...standardRules('hockey'), periods: 2 })).toBeNull();
  expect(rulesRefusal('basketball', { ...standardRules('basketball'), periodMinutes: 10 })).toBeNull(); // opened in 3.30
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
