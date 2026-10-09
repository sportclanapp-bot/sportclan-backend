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
test('the limit: off, or whole 1 or more (Stage 13 · CR3: no top)', () => {
  expect([RETIRE_MIN, RETIRE_MAX]).toEqual([1, Number.MAX_SAFE_INTEGER]);
  const r = (retireAt: unknown) => rulesRefusal('cricket', { ...standardRules('cricket'), retireAt });
  expect(r(null)).toBeNull();
  expect(r(25)).toBeNull();
  for (const ok of [1, 5, 100, 101, 500]) expect(r(ok)).toBeNull(); // Stage 13 · CR3: the old top and above are fine
  for (const bad of [0, -1, 25.5]) expect(r(bad)?.error).toBe('Retire at must be off, or a whole number of runs, 1 or more.');
});
test('the scorecard says "retired not out" and brings them back if they bat again', () => {
  const sc = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(sc).toContain("b.dismissal = wt === 'retirednotout' ? 'retired_not_out' : 'retired_hurt';");
  expect(sc).toContain("(b.dismissal === 'retired_hurt' || b.dismissal === 'retired_not_out')) delete b.dismissal;");
});
