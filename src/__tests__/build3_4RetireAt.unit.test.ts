/**
 * BUILD 3.4 · retire at N runs: a batter who reaches the match's limit retires
 * NOT OUT (wicket_type "retired_not_out") — not a wicket, no ball, and they may
 * bat again, like retired hurt.
 */
import fs from 'fs';
import path from 'path';
import { isDismissal, RETIRE_MIN, RETIRE_MAX } from '../utils/cricketRules';
import { isKnownWicketType } from '../utils/cricketEventTypes';
import { rulesRefusal, standardRules } from '../utils/matchRules';

test('not a dismissal, and a known kind', () => {
  expect(isDismissal('retired_not_out')).toBe(false);
  expect(isDismissal('retired_hurt')).toBe(false);
  expect(isDismissal('retired_out')).toBe(true);
  expect(isKnownWicketType('retired_not_out')).toBe(true);
});
test('the limit: off, or whole 10–100', () => {
  expect([RETIRE_MIN, RETIRE_MAX]).toEqual([10, 100]);
  const r = (retireAt: unknown) => rulesRefusal('cricket', { ...standardRules('cricket'), retireAt });
  expect(r(null)).toBeNull();
  expect(r(25)).toBeNull();
  for (const bad of [5, 101, 25.5]) expect(r(bad)?.field).toBe('retireAt');
});
test('the scorecard says "retired not out" and brings them back if they bat again', () => {
  const sc = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(sc).toContain("b.dismissal = wt === 'retirednotout' ? 'retired_not_out' : 'retired_hurt';");
  expect(sc).toContain("(b.dismissal === 'retired_hurt' || b.dismissal === 'retired_not_out')) delete b.dismissal;");
});
