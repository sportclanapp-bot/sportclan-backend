/**
 * N-R7-S25 (Step 2 · Batch 10 · SP-VBL-171): a best-of-1 volleyball match has no
 * deciding set — the pad plays its one set to the set target (matchRules drops
 * finalTarget when bestOf is 1), so the typed score sheet must too. Before the
 * fix a typed 25–20 was refused ("it ends at 22–20") and 15–10 was accepted
 * though the pad then left the set unfinished.
 */
import { typedMatchPoints } from '../utils/typedScore';

const VB = { bestOf: 1, target: 25, finalTarget: 15, winBy2: true, cap: null } as any;

describe('N-R7-S25 · one-set volleyball typed score', () => {
  it('takes a one-set 25–20 as finished', () => {
    const r = typedMatchPoints('volleyball', VB, [{ a: 25, b: 20 }]);
    expect(r.problem).toBeNull();
    expect(r.winner).toBe('A');
  });
  it('refuses 15–10 in a one-set match to 25', () => {
    const r = typedMatchPoints('volleyball', VB, [{ a: 15, b: 10 }]);
    expect(r.problem).toMatch(/isn’t finished — to 25/);
  });
  it('still plays a best-of-5 decider to 15', () => {
    const r = typedMatchPoints('volleyball', { ...VB, bestOf: 5 }, [{ a: 25, b: 20 }, { a: 20, b: 25 }, { a: 25, b: 20 }, { a: 20, b: 25 }, { a: 15, b: 10 }]);
    expect(r.problem).toBeNull();
    expect(r.winner).toBe('A');
  });
});
