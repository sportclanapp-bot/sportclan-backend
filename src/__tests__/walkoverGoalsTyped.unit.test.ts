/**
 * F176 (launch test plan, Round 1) · a typed football walkover score is kept.
 *
 * New match lets the organiser type any whole number of walkover goals (Stage 13
 * CR3, no cap), and the rules validator accepts it — but walkoverGoalsOf answered
 * 5 only for exactly 5 and 3 for everything else, so a typed 10 (or 4) was saved
 * as 3–0, changing goal difference and the table. The rules line said only
 * 'walkover 5–0'.
 */
import { walkoverGoalsOf, timedRulesLabel } from '../utils/matchRules';

describe('F176 · football walkover goals as typed', () => {
  it.each([[3, 3], [5, 5], [4, 4], [10, 10], [1, 1]])('walkoverGoals %i → %i–0', (typed, want) => {
    expect(walkoverGoalsOf('football', { v: 1, walkoverGoals: typed } as never)).toBe(want);
  });
  it('unset (or not a whole number ≥ 1) is the Laws default 3', () => {
    expect(walkoverGoalsOf('football', { v: 1 } as never)).toBe(3);
    expect(walkoverGoalsOf('football', { v: 1, walkoverGoals: 0 } as never)).toBe(3);
    expect(walkoverGoalsOf('football', { v: 1, walkoverGoals: 2.5 } as never)).toBe(3);
  });
  it('other sports keep a walkover scoreless', () => {
    expect(walkoverGoalsOf('hockey', { v: 1, walkoverGoals: 10 } as never)).toBeNull();
  });
  it('the rules line says any walkover score that is not the 3–0 default', () => {
    expect(timedRulesLabel('football', { v: 1, walkoverGoals: 10 } as never)).toContain('walkover 10–0');
    expect(timedRulesLabel('football', { v: 1, walkoverGoals: 5 } as never)).toContain('walkover 5–0');
    expect(timedRulesLabel('football', { v: 1, walkoverGoals: 3 } as never) ?? '').not.toContain('walkover');
  });
});
