/**
 * SC-441 (M3) · past-dated matches must stop being discoverable, and a match
 * nobody ever started must eventually say so.
 *
 * The bug this pins: the open-match query had NO date predicate of any kind, and
 * the only staleness signal — a −25 relevance penalty — sat behind
 * `if (matches.length > 1)`, so in the single-candidate case it never ran. A
 * two-month-old fixture was served to a brand-new account as the top suggestion,
 * still joinable. Nothing anywhere moved it out of `scheduled`.
 */
import {
  DISCOVERY_GRACE_HOURS,
  UNPLAYED_ABANDON_HOURS,
  discoveryCutoffIso,
} from '../controllers/matches.controller';

const HOUR = 3600_000;

describe('SC-441 · discovery cutoff', () => {
  const now = Date.parse('2026-09-22T12:00:00.000Z');

  test('the cutoff is exactly the grace window behind now', () => {
    expect(discoveryCutoffIso(now)).toBe(new Date(now - DISCOVERY_GRACE_HOURS * HOUR).toISOString());
  });

  test('a match starting later is still discoverable', () => {
    const inAnHour = new Date(now + HOUR).toISOString();
    expect(inAnHour >= discoveryCutoffIso(now)).toBe(true);
  });

  test('a LATE start is not hidden mid-game — that is what the grace is for', () => {
    // Decision D2 chose 6h precisely so a match that starts late, or runs long
    // before anyone scores, never vanishes from the hub while it is happening.
    const startedFiveHoursAgo = new Date(now - 5 * HOUR).toISOString();
    expect(startedFiveHoursAgo >= discoveryCutoffIso(now)).toBe(true);
  });

  test('a match from two months ago is hidden — the reported bug', () => {
    const july = new Date(now - 60 * 24 * HOUR).toISOString();
    expect(july >= discoveryCutoffIso(now)).toBe(false);
  });

  test('the windows are the decided values, and abandon is well after hide', () => {
    expect(DISCOVERY_GRACE_HOURS).toBe(6);
    expect(UNPLAYED_ABANDON_HOURS).toBe(48);
    // Hiding must come first: a match should stop being offered long before it
    // is declared abandoned, never the other way round.
    expect(UNPLAYED_ABANDON_HOURS).toBeGreaterThan(DISCOVERY_GRACE_HOURS);
  });
});
