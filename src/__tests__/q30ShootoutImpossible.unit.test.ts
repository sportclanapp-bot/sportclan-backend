/**
 * Q30 (Dipak, 21 Nov 2026: A) · N-R3R3B-2: a shoot-out tally that can't happen within the kicks
 * (it stops once one side can't catch up) is refused with a clear message — the venue desk, the pad
 * and the server all use this rule. 5–0 / 4–0 with 5 each and 3–0 with 3 each were accepted.
 */
import { shootoutProblem, validShootout } from "../utils/shootoutRules";

test.each([
  [3, 0, 5, true], [4, 0, 5, false], [5, 0, 5, false], [4, 1, 5, true], [5, 1, 5, false], [5, 2, 5, false], [5, 3, 5, true], [5, 4, 5, true],
  [2, 0, 3, true], [3, 0, 3, false], [3, 1, 3, true], [1, 0, 5, true], [6, 5, 5, true], [4, 0, null, true],
])("%i–%i with %s each → %s", (a, b, kicks, ok) => {
  expect(validShootout(a, b, kicks)).toBe(ok);
  expect(validShootout(b, a, kicks)).toBe(ok);
});

test("the words", () => {
  expect(shootoutProblem(4, 0, 5)).toBe("4–0 can’t happen with 5 kicks each: the shootout stops once one side can’t catch up (3–0 at most).");
  expect(shootoutProblem(0, 3, 3)).toBe("3–0 can’t happen with 3 kicks each: the shootout stops once one side can’t catch up (2–0 at most).");
  expect(shootoutProblem(5, 0, 5, "hockey")).toBe("5–0 can’t happen with 5 attempts each: the shoot-out stops once one side can’t catch up (3–0 at most).");
});
