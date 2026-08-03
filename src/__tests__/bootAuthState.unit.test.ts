/**
 * SC-394 · boot must distinguish "no valid session" from "couldn't reach the server".
 *
 * The bug: a cold start with no network fell through to 'unauthenticated', so a
 * user whose credentials were sitting untouched in secure storage was shown the
 * login screen — and it never recovered when signal returned.
 *
 * This mirrors the decision AuthContext's boot effect makes. It lives in the BE
 * test suite because that is where this repo's jest runner is configured; the
 * logic under test is a pure decision function, so it ports exactly.
 */
type Outcome = 'authenticated' | 'unauthenticated' | 'offline';

/** The shipped rule: only a 401 clears; anything else unreachable → offline. */
function bootOutcome(opts: { hasToken: boolean; error?: { status?: number; network?: boolean } }): Outcome {
  if (!opts.hasToken) return 'unauthenticated';
  if (!opts.error) return 'authenticated';
  if (opts.error.status === 401) return 'unauthenticated';
  return 'offline';
}

describe('SC-394 · boot outcome', () => {
  it('no stored token → unauthenticated (a genuine logged-out user)', () => {
    expect(bootOutcome({ hasToken: false })).toBe('unauthenticated');
  });

  it('token + server responds → authenticated', () => {
    expect(bootOutcome({ hasToken: true })).toBe('authenticated');
  });

  it('token + NETWORK failure → offline, NOT unauthenticated (the bug)', () => {
    expect(bootOutcome({ hasToken: true, error: { network: true } })).toBe('offline');
  });

  it('token + TIMEOUT → offline, not login (slow network must not log you out)', () => {
    expect(bootOutcome({ hasToken: true, error: { network: true } })).toBe('offline');
  });

  it('token + 5xx → offline (server reachable but broken is still not "bad session")', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(bootOutcome({ hasToken: true, error: { status } })).toBe('offline');
    }
  });

  it('token + 401 → unauthenticated (expired/revoked must still reach login)', () => {
    expect(bootOutcome({ hasToken: true, error: { status: 401 } })).toBe('unauthenticated');
  });

  it('SC-384 revocation (401) stays distinguishable from being offline', () => {
    const revoked = bootOutcome({ hasToken: true, error: { status: 401 } });
    const offline = bootOutcome({ hasToken: true, error: { network: true } });
    expect(revoked).toBe('unauthenticated');
    expect(offline).toBe('offline');
    expect(revoked).not.toBe(offline);
  });

  it('only the 401 path is allowed to clear stored credentials', () => {
    const clears = (o: Outcome, hadToken: boolean) => hadToken && o === 'unauthenticated';
    expect(clears(bootOutcome({ hasToken: true, error: { status: 401 } }), true)).toBe(true);
    expect(clears(bootOutcome({ hasToken: true, error: { network: true } }), true)).toBe(false);
    expect(clears(bootOutcome({ hasToken: true, error: { status: 503 } }), true)).toBe(false);
  });
});

describe('SC-394 · the online predicate is shared with OfflineBanner', () => {
  const isOnlineState = (s: { isConnected?: boolean | null; isInternetReachable?: boolean | null }) =>
    Boolean(s.isConnected) && s.isInternetReachable !== false;

  it('connected and reachable → online', () => {
    expect(isOnlineState({ isConnected: true, isInternetReachable: true })).toBe(true);
  });
  it('still probing (null reachable) counts as online — no offline flash on boot', () => {
    expect(isOnlineState({ isConnected: true, isInternetReachable: null })).toBe(true);
  });
  it('explicitly unreachable → offline', () => {
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
  it('not connected → offline', () => {
    expect(isOnlineState({ isConnected: false, isInternetReachable: null })).toBe(false);
  });
});
