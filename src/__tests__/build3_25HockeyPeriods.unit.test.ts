/**
 * BUILD 3.25 · hockey periods: quarters or halves (1–4), 5–35 minutes each.
 * Commentary: "End of Q3" for quarters, "Half-time" for halves, else the period.
 */
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';
import { sportCommentary } from '../utils/commentary';

const hk = (x: object) => rulesRefusal('hockey', { ...standardRules('hockey'), ...x });
test('periods 1 or more, 1 minute or more (Stage 13 · CR3: no tops)', () => {
  for (const ok of [{ periods: 2 }, { periods: 1 }, { periods: 5 }, { periodMinutes: 1 }, { periodMinutes: 5 }, { periodMinutes: 35 }, { periodMinutes: 36 }]) expect(hk(ok)).toBeNull();
  expect(hk({ periods: 0 })?.field).toBe('periods');
  expect(hk({ periodMinutes: 0 })?.error).toBe('A period must be off, or a whole number of minutes.');
  expect(timedRulesLabel('hockey', { ...standardRules('hockey'), periodMinutes: 15 })).toBe('4 × 15 min');
});
test('commentary', () => {
  const ctx = (regulation: number, period: number) => ({ sport: 'hockey', teamA: 'A', teamB: 'B', period, regulation });
  expect(sportCommentary('period_change', { kind: 'quarter' }, ctx(4, 3))).toBe('End of Q3');
  expect(sportCommentary('period_change', { kind: 'halftime' }, ctx(2, 1))).toBe('Half-time');
  expect(sportCommentary('period_change', { kind: 'period' }, ctx(3, 1))).toBe('End of period 1');
});
