/**
 * SC-359 · team capacity boundary.
 *
 * Exercises the REAL decision function that `joinGate` calls, so this is the
 * rule itself rather than a restatement of it. A live 49/50/51 test would need
 * 50 distinct accounts in prod; the arithmetic is pure, so it belongs here — and
 * that the gate is actually WIRED into all four join paths is proven separately
 * and live by the ban half of the same `joinGate` (SC-359 ban matrix), which
 * fires from join-by-code, join-request and approval.
 */
import { isAtCapacity, TEAM_MAX_MEMBERS } from '../controllers/teams.controller';

describe('SC-359 · team capacity', () => {
  it('ships a cap of 50', () => {
    // Guard against a lowered test value ever being committed.
    expect(TEAM_MAX_MEMBERS).toBe(50);
  });

  it('49 → has room, 50 → full, 51 → full', () => {
    expect(isAtCapacity(49, 50)).toBe(false);
    expect(isAtCapacity(50, 50)).toBe(true);
    expect(isAtCapacity(51, 50)).toBe(true); // over-capacity stays closed
  });

  it('is >= not >, so the cap is a maximum and not an off-by-one', () => {
    // The classic bug: `> max` lets a 51st member in. Assert the boundary
    // exactly at the cap.
    for (let n = 0; n < 50; n++) expect(isAtCapacity(n, 50)).toBe(false);
    expect(isAtCapacity(50, 50)).toBe(true);
  });

  it('works at a lowered cap too — the value is a parameter, not a hard-code', () => {
    expect(isAtCapacity(2, 3)).toBe(false);
    expect(isAtCapacity(3, 3)).toBe(true);
    expect(isAtCapacity(4, 3)).toBe(true);
  });

  it('an empty team always has room', () => {
    expect(isAtCapacity(0)).toBe(false);
  });
});
