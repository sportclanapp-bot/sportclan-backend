/**
 * SC-424 · a voided match counts nowhere.
 *
 * A test fixture played on real team rosters put batting and bowling figures on
 * four real players. The only tools available were "leave it there" or "delete
 * rows on prod". Voiding is the third: the match and its events stay, a flag says
 * it does not count, every rollup honours the flag, and it is reversible.
 *
 * These pin the two halves of that promise. The first block is the shared
 * predicate every rollup reads. The second is the arithmetic that walks back the
 * counters completion had already materialised — the part a query filter cannot
 * reach, and the part that must be exactly reversible or a void would quietly
 * corrupt the records it is meant to correct.
 */
import { countsTowardRecord } from '../utils/matchCounts';
import { isVoided, shouldHideVoided, HIDE_VOIDED_FOR_STATUSES } from '../utils/matchVoid';

const completed = (over: Record<string, unknown> = {}) =>
  ({ status: 'completed', is_ranked: false, ...over });

describe('SC-424 · the shared rule', () => {
  it('excludes a voided match that would otherwise count', () => {
    expect(countsTowardRecord(completed({ is_ranked: true }), 2)).toBe(true);
    expect(countsTowardRecord(completed({ is_ranked: true, voided_at: '2026-09-21T10:00:00Z' }), 2)).toBe(false);
  });

  it('excludes a voided CASUAL match too — the rule is not ranked-only', () => {
    expect(countsTowardRecord(completed(), 2)).toBe(true);
    expect(countsTowardRecord(completed({ voided_at: '2026-09-21T10:00:00Z' }), 2)).toBe(false);
  });

  it('treats null/undefined voided_at as "not voided", so existing rows are unaffected', () => {
    expect(countsTowardRecord(completed({ is_ranked: true, voided_at: null }), 2)).toBe(true);
    expect(countsTowardRecord(completed({ is_ranked: true }), 2)).toBe(true);
  });

  it('isVoided reads the flag, not the status', () => {
    expect(isVoided({ voided_at: '2026-09-21T10:00:00Z' })).toBe(true);
    expect(isVoided({ voided_at: null })).toBe(false);
    expect(isVoided(null)).toBe(false);
    expect(isVoided(undefined)).toBe(false);
  });
});

/**
 * The reversal arithmetic, stated as a pure function of the same shape
 * applyRecordDeltas writes. Kept here rather than exercised through supabase so
 * the property that matters — void then unvoid is the identity — is pinned
 * without a database.
 */
function applyLocal(
  profile: { rating: number; matches_played: number; wins: number; losses: number; draws: number },
  delta: { rating: number; matches_played: number; wins: number; losses: number; draws: number },
  sign: 1 | -1,
) {
  const clamp0 = (n: number) => (n < 0 ? 0 : n);
  return {
    matches_played: clamp0(profile.matches_played + sign * delta.matches_played),
    wins: clamp0(profile.wins + sign * delta.wins),
    losses: clamp0(profile.losses + sign * delta.losses),
    draws: clamp0(profile.draws + sign * delta.draws),
    rating: Math.max(100, Math.round((profile.rating + sign * delta.rating) * 100) / 100),
  };
}

describe('SC-424 · walking back what completion materialised', () => {
  const profile = { rating: 1216.4, matches_played: 7, wins: 4, losses: 2, draws: 1 };

  it('a voided WIN gives back the match and the win, and the rating with it', () => {
    const delta = { rating: 16.4, matches_played: 1, wins: 1, losses: 0, draws: 0 };
    expect(applyLocal(profile, delta, -1)).toEqual({
      matches_played: 6, wins: 3, losses: 2, draws: 1, rating: 1200,
    });
  });

  it('a voided DRAW takes back the draw, not a win or a loss', () => {
    const delta = { rating: 0, matches_played: 1, wins: 0, losses: 0, draws: 1 };
    const after = applyLocal(profile, delta, -1);
    expect(after.draws).toBe(0);
    expect(after.wins).toBe(4);
    expect(after.losses).toBe(2);
    expect(after.matches_played).toBe(6);
  });

  it('void then unvoid is the identity — restoring cannot drift', () => {
    const delta = { rating: -12.5, matches_played: 1, wins: 0, losses: 1, draws: 0 };
    const voided = applyLocal(profile, delta, -1);
    expect(applyLocal(voided, delta, 1)).toEqual(profile);
  });

  it('a CASUAL match moves no rating, only the counters', () => {
    const delta = { rating: 0, matches_played: 1, wins: 0, losses: 0, draws: 1 };
    expect(applyLocal(profile, delta, -1).rating).toBe(profile.rating);
  });

  it('a double void can never drive a record negative', () => {
    const fresh = { rating: 1200, matches_played: 1, wins: 1, losses: 0, draws: 0 };
    const delta = { rating: 0, matches_played: 1, wins: 1, losses: 0, draws: 0 };
    const once = applyLocal(fresh, delta, -1);
    const twice = applyLocal(once, delta, -1);
    expect(once).toEqual({ matches_played: 0, wins: 0, losses: 0, draws: 0, rating: 1200 });
    expect(twice).toEqual(once);
  });

  it('rating is floored at 100, the same floor completion clamps to', () => {
    const low = { rating: 105, matches_played: 3, wins: 0, losses: 3, draws: 0 };
    const delta = { rating: 20, matches_played: 1, wins: 1, losses: 0, draws: 0 };
    expect(applyLocal(low, delta, -1).rating).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// SC-441 (M2) · a voided match must not be LISTED as live or upcoming, but must
// stay readable from history.
//
// SC-424 swept the rollups and stopped there, on the reasoning that a single
// match page shows the void banner rather than hiding the match. That reasoning
// does not carry to a list: the Sport Hub read "1 LIVE" and Home promoted
// "FEATURED · LIVE" for matches that were voided, VOIDED pill and all.
describe('SC-441 · shouldHideVoided', () => {
  test('hides voided rows from every pre-completion status', () => {
    for (const status of ['scheduled', 'live']) {
      expect(shouldHideVoided({ status })).toBe(true);
    }
  });

  test('an unscoped list is discovery, so it hides them too', () => {
    expect(shouldHideVoided({})).toBe(true);
    expect(shouldHideVoided({ status: null })).toBe(true);
  });

  test('history KEEPS them — decision D2', () => {
    // Past results.
    expect(shouldHideVoided({ status: 'completed' })).toBe(false);
    expect(shouldHideVoided({ status: 'abandoned' })).toBe(false);
    // A team's match history, even for a live-shaped status.
    expect(shouldHideVoided({ status: 'live', teamScoped: true })).toBe(false);
    // Your own match list.
    expect(shouldHideVoided({ status: 'live', mine: true })).toBe(false);
  });

  test('the scoping override beats the status', () => {
    // This is the pairing that makes the rule non-trivial: the same status
    // hides in discovery and shows in history.
    expect(shouldHideVoided({ status: 'scheduled' })).toBe(true);
    expect(shouldHideVoided({ status: 'scheduled', teamScoped: true })).toBe(false);
  });

  test('the hidden-status list is exactly the pre-completion ones', () => {
    // Pinned so adding a new status forces a decision rather than defaulting to
    // "visible", which is how this bug happened in the first place.
    expect([...HIDE_VOIDED_FOR_STATUSES].sort()).toEqual(['live', 'scheduled']);
  });
});
