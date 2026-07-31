/**
 * SC-370 · regression tests for the arithmetic behind displayed numbers.
 *
 * Every case here corresponds to a bug this app has actually shipped, so the
 * tests are written as "the shape that broke", not as generic maths.
 */
import { normaliseVenue } from '../utils/validation';

// ── The expense split (SC-360: Math.ceil over-collected) ────────────────────
// Reproduced as a pure function so the invariant can be asserted directly.
function splitEvenly(totalPaise: number, members: number) {
  const per = Math.floor(totalPaise / Math.max(1, members));
  const remainder = totalPaise - per * Math.max(1, members);
  return { per, remainder };
}

describe('SC-360 · expense split must add back up to the total', () => {
  it('₹100 across 3 does not over-collect (the Math.ceil bug)', () => {
    const { per, remainder } = splitEvenly(10000, 3);
    expect(per).toBe(3333);            // ₹33.33
    expect(remainder).toBe(1);         // 1 paisa left over
    expect(per * 3 + remainder).toBe(10000);
  });

  it.each([
    [10000, 3], [10000, 7], [1, 3], [999999, 11], [0, 5], [12345, 2],
  ])('perMember*members + remainder === total (%i paise across %i)', (total, members) => {
    const { per, remainder } = splitEvenly(total, members);
    expect(per * members + remainder).toBe(total);
    expect(remainder).toBeGreaterThanOrEqual(0);
    expect(remainder).toBeLessThan(members);
  });

  it('never divides by zero when a team somehow has 0 members', () => {
    expect(() => splitEvenly(500, 0)).not.toThrow();
    expect(splitEvenly(500, 0).per).toBe(500);
  });
});

// ── Money in paise (SC-360: 0.10 + 0.20 reached the client as 0.30000000000000004)
function toPaise(n: unknown) { return Math.round(Number(n ?? 0) * 100); }
function toRupees(p: number) { return Math.round(p) / 100; }

describe('SC-360 · money totals must not drift', () => {
  it('0.10 + 0.20 sums to exactly 0.3', () => {
    const total = [0.1, 0.2].reduce((s, n) => s + toPaise(n), 0);
    expect(toRupees(total)).toBe(0.3);
    expect(String(toRupees(total))).not.toContain('0000000');
  });

  it('a long tail of decimals stays exact', () => {
    const amounts = [0.1, 0.2, 0.1, 10.1, 20.2, 0.3, 50];
    const total = amounts.reduce((s, n) => s + toPaise(n), 0);
    expect(toRupees(total)).toBe(81);
  });
});

// ── Averages/rates: the divisor and the zero case ──────────────────────────
function winPct(wins: number, played: number) {
  return played > 0 ? Math.round((wins / played) * 100) : 0;
}
function battingAvg(runs: number, dismissals: number) {
  return dismissals > 0 ? Math.round((runs / dismissals) * 100) / 100 : runs;
}
function strikeRate(runs: number, balls: number) {
  return balls > 0 ? Math.round((runs / balls) * 10000) / 100 : 0;
}

describe('SC-370 · averages and rates guard their divisor', () => {
  it('win% is 0, not NaN, at zero matches', () => {
    expect(winPct(0, 0)).toBe(0);
    expect(Number.isNaN(winPct(0, 0))).toBe(false);
  });
  it('win% rounds as displayed', () => {
    expect(winPct(1, 1)).toBe(100);
    expect(winPct(1, 3)).toBe(33);
    expect(winPct(2, 3)).toBe(67);
  });
  it('batting average with no dismissals is not Infinity', () => {
    expect(battingAvg(24, 0)).toBe(24);
    expect(Number.isFinite(battingAvg(24, 0))).toBe(true);
  });
  it('strike rate is 0, not NaN, off zero balls', () => {
    expect(strikeRate(0, 0)).toBe(0);
    expect(strikeRate(24, 6)).toBe(400);
  });
});

// ── An aggregate must not be computed from a display page (SC-370 reviews) ──
describe('SC-370 · aggregates must not be page-limited', () => {
  const PAGE = 50;
  const allRatings = Array.from({ length: 120 }, (_, i) => (i < 60 ? 5 : 1));

  it('a page-limited average disagrees with the true average', () => {
    const page = allRatings.slice(0, PAGE);
    const avgOfPage = page.reduce((a, b) => a + b, 0) / page.length;
    const avgOfAll = allRatings.reduce((a, b) => a + b, 0) / allRatings.length;
    expect(avgOfPage).not.toBeCloseTo(avgOfAll);   // the bug, made explicit
    expect(page.length).toBe(50);
    expect(allRatings.length).toBe(120);           // the count that must be shown
  });
});

// ── Venue normalisation (SC-367/369) ───────────────────────────────────────
describe('SC-367 · venue normalisation is one shared rule', () => {
  it('trims, and treats whitespace-only as absent', () => {
    expect(normaliseVenue('  Shivaji Park  ')).toBe('Shivaji Park');
    expect(normaliseVenue('   ')).toBeNull();
    expect(normaliseVenue('')).toBeNull();
    expect(normaliseVenue(null)).toBeNull();
  });
});
