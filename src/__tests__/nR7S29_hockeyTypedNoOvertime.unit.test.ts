/**
 * N-R7-S29 (Step 2 · Batch 12 · SP-HOC-200): hockey has no overtime — a level
 * match is a draw or goes to a shoot-out — but a typed sheet took an 'OT1'
 * period after a level regulation (1–1 then OT1 1–0 saved as 2–1).
 */
import { typedPeriodPoints } from '../utils/typedScore';

test('hockey: a period past regulation is refused', () => {
  const r = typedPeriodPoints('hockey', { periods: 4, drawAllowed: true } as never, [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 0, b: 0 }, { a: 0, b: 0 }, { a: 1, b: 0 }]);
  expect(r.problem).toBe('Hockey has no overtime — a level match is a draw, or a knockout goes to a shoot-out.');
});
test('hockey regulation and football extra time unchanged', () => {
  expect(typedPeriodPoints('hockey', { periods: 4, drawAllowed: true } as never, [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 0, b: 0 }, { a: 0, b: 0 }]).problem).toBeNull();
  expect(typedPeriodPoints('football', { periods: 2, drawAllowed: true } as never, [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }]).problem).toBeNull();
});
test('hockey: an extra period after a decided regulation keeps its own message', () => {
  expect(typedPeriodPoints('hockey', { periods: 4, drawAllowed: true } as never, [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }, { a: 0, b: 1 }, { a: 0, b: 1 }]).problem).toBe('OT1 isn’t played — the score wasn’t level.');
});
