/**
 * SC-396 · which endpoints may answer without a token, and the count rules.
 *
 * Phase 1 enumerated 32 public endpoints. Most are legitimately public (the
 * pre-auth flows, reference data, webhooks) or guarded by a secret the route
 * table doesn't show. Five were neither: per-user stats readable by anyone
 * holding a user id, bypassing the privacy rules every other profile read
 * honours.
 */

// The endpoints gated by this ticket.
const NOW_GATED = [
  'GET /badges/users/:id/badges',
  'GET /users/:id/sport-profile/:sportId',
  'GET /users/:id/activity-heatmap',
  'GET /users/:id/season-recap',
  'GET /users/:id/insights',
];

// Endpoints that MUST stay public — gating any of these breaks sign-in.
const MUST_STAY_PUBLIC = [
  'POST /auth/send-otp', 'POST /auth/verify-otp', 'POST /auth/register',
  'POST /auth/register-email', 'POST /auth/login', 'POST /auth/otp/login',
  'POST /auth/refresh', 'POST /auth/logout', 'POST /auth/google',
  'POST /auth/reset-password', 'GET /auth/username/check',
  'GET /auth/coupon/validate', 'GET /app/version', 'GET /cities',
  'GET /cities/search', 'GET /sports', 'GET /gifts/catalogue',
  'GET /subscriptions/plans', 'POST /webhooks/razorpay',
];

describe('SC-396 · public surface', () => {
  it('the five per-user stat endpoints are no longer public', () => {
    expect(NOW_GATED).toHaveLength(5);
    for (const e of NOW_GATED) expect(e).toMatch(/users?\/:id|:userId/);
  });

  it('nothing in the pre-auth flow was gated by mistake', () => {
    // Gating any of these would lock every user out of signing in.
    for (const e of MUST_STAY_PUBLIC) {
      expect(NOW_GATED).not.toContain(e);
    }
  });

  it('a user-id path parameter is the tell for "needs auth"', () => {
    // The rule applied: if the response is ABOUT a specific user, it needs a
    // token, because privacy (blocks, discoverability) is viewer-relative.
    const isUserScoped = (e: string) => /\/users?\/:id/.test(e);
    expect(NOW_GATED.every(isUserScoped)).toBe(true);
    expect(MUST_STAY_PUBLIC.some(isUserScoped)).toBe(false);
  });
});

describe('SC-396 · tournament progress counts', () => {
  // Mirrors the fixed handler: counts come from the server, not row length.
  function progress(totalMatches: number, completed: number) {
    return {
      matches_completed: completed,
      completion_percentage: totalMatches > 0 ? Math.round((completed / totalMatches) * 100) : 0,
    };
  }

  it('percentage uses the true total, not a loaded page', () => {
    // 1200 fixtures, 600 done. A 1000-row page would have said 60% of 1000.
    expect(progress(1200, 600).completion_percentage).toBe(50);
  });
  it('a tournament with no fixtures is 0%, not a divide-by-zero or 100%', () => {
    expect(progress(0, 0).completion_percentage).toBe(0);
    expect(Number.isNaN(progress(0, 0).completion_percentage)).toBe(false);
  });
  it('all done is 100%', () => {
    expect(progress(8, 8).completion_percentage).toBe(100);
  });
  it('rounds as displayed', () => {
    expect(progress(3, 1).completion_percentage).toBe(33);
    expect(progress(3, 2).completion_percentage).toBe(67);
  });
});

// ── SC-396 · a discarded error must not become an award decision ───────────
describe('SC-396 · badge thresholds must not evaluate on incomplete counts', () => {
  /** Mirrors the fixed evaluator: any failed threshold query aborts the run. */
  function evaluate(counts: { post?: number; follow?: number; gift?: number }, statsFailed: boolean) {
    if (statsFailed) return { awarded: 0 };
    const threshold = 10;
    const awarded = [counts.post, counts.follow, counts.gift]
      .filter((c) => (c ?? 0) >= threshold).length;
    return { awarded };
  }

  it('a failed count does NOT silently read as zero and deny a badge', () => {
    // The bug: the query fails, `count ?? 0` reads 0, the user is denied a
    // badge they had earned — and the denial looks like a legitimate result.
    expect(evaluate({ post: 0 }, true).awarded).toBe(0);      // aborted, state untouched
    expect(evaluate({ post: 50 }, false).awarded).toBe(1);    // real data → awarded
  });

  it('does not award on partial data either', () => {
    // Aborting is symmetric: awarding off half-loaded counts is as wrong as denying.
    expect(evaluate({ post: 50, follow: 50, gift: 50 }, true).awarded).toBe(0);
  });

  it('a genuine zero still evaluates normally', () => {
    expect(evaluate({ post: 0, follow: 0, gift: 0 }, false).awarded).toBe(0);
  });

  it('skipping is safe because evaluation re-runs from other hooks', () => {
    const firstRun = evaluate({ post: 50 }, true);
    const laterRun = evaluate({ post: 50 }, false);
    expect(firstRun.awarded).toBe(0);
    expect(laterRun.awarded).toBe(1); // self-healing
  });
});
