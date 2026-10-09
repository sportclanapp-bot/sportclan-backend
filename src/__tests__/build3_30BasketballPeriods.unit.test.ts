/**
 * BUILD 3.30 · basketball periods 1–4, 3–20 minutes each (length shown only).
 * Periods are named by count — Q1–Q4, H1/H2, P1–P3 — then OT1, OT2 …
 */
import { periodLabelOf, periodsNounOf } from '../utils/basketballRules';
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test.each([[1, 4, 'Q1'], [5, 4, 'OT1'], [2, 2, 'H2'], [3, 2, 'OT1'], [3, 3, 'P3'], [1, 1, 'P1'], [2, 1, 'OT1']])('period %i of %i → %s', (n, reg, want) => {
  expect(periodLabelOf(n as number, reg as number)).toBe(want);
});
test('nouns, rules, label', () => {
  expect([4, 2, 3, 1].map(periodsNounOf)).toEqual(['4 quarters', '2 halves', '3 periods', '1 period']);
  const b = (x: object) => rulesRefusal('basketball', { ...standardRules('basketball'), ...x });
  // Stage 13 · CR3: no tops — the old top (20 min) and above are fine.
  for (const ok of [{ periods: 2 }, { periods: 5 }, { periodMinutes: 1 }, { periodMinutes: 3 }, { periodMinutes: 20 }, { periodMinutes: 21 }]) expect(b(ok)).toBeNull();
  expect(b({ periodMinutes: 0 })?.error).toBe('A period must be off, or a whole number of minutes.');
  expect(b({ periods: 0 })?.field).toBe('periods');
  expect(timedRulesLabel('basketball', { ...standardRules('basketball'), periodMinutes: 10 })).toBe('4 × 10 min');
});
test('the end-of-period push and the timeline name the match’s periods', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { quarterPush } = require('../utils/scorePush');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sportCommentary } = require('../utils/commentary');
  expect(quarterPush({ quarter: 1, regulation: 2, summary: {}, teamAName: 'A', teamBName: 'B' }).title).toBe('End of H1');
  expect(quarterPush({ quarter: 4, summary: {}, teamAName: 'A', teamBName: 'B' }).title).toBe('End of Q4');
  expect(sportCommentary('period_change', { kind: 'quarter' }, { sport: 'basketball', teamA: 'A', teamB: 'B', period: 3, regulation: 2 })).toBe('End of OT1');
  expect(sportCommentary('period_change', { kind: 'quarter' }, { sport: 'basketball', teamA: 'A', teamB: 'B', period: 2, regulation: 4 })).toBe('End of Q2');
});
