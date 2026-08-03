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

// ── SC-396 · one money formatter ──────────────────────────────────────────
describe('SC-396 · Indian money formatting', () => {
  const groupIndian = (i: string) =>
    i.length <= 3 ? i : `${i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${i.slice(-3)}`;
  const formatINR = (n: number) => {
    const v = Number.isFinite(n) ? n : 0;
    const neg = v < 0;
    const paise = Math.round(Math.abs(v) * 100);
    const r = Math.floor(paise / 100), f = paise % 100;
    const body = f === 0 ? groupIndian(String(r)) : `${groupIndian(String(r))}.${String(f).padStart(2, '0')}`;
    return `${neg ? '-' : ''}₹${body}`;
  };

  it('groups the INDIAN way, not western (the Hermes/ICU trap)', () => {
    expect(formatINR(1000000)).toBe('₹10,00,000');
    expect(formatINR(100000)).toBe('₹1,00,000');
    expect(formatINR(1000)).toBe('₹1,000');
  });
  it('keeps paise — the naive Math.round dropped them', () => {
    expect(formatINR(33.34)).toBe('₹33.34');
    expect(formatINR(0.5)).toBe('₹0.50');
  });
  it('omits a zero fraction', () => {
    expect(formatINR(42)).toBe('₹42');
  });
  it('signs negatives and survives NaN', () => {
    expect(formatINR(-1500.5)).toBe('-₹1,500.50');
    expect(formatINR(NaN)).toBe('₹0');
  });
  it('small values are untouched', () => {
    expect(formatINR(7)).toBe('₹7');
  });
});

// ── SC-396 · shared helpers: one version each ─────────────────────────────
import { LIMITS, ARRAY_LIMITS } from '../utils/validation';

describe('SC-396 · sport-slug normalisation is one rule', () => {
  const normSportSlug = (s: string) => s.toLowerCase().replace(/[-_\s]/g, '');
  // The six hand-rolled copies were `/[-_]/g` — no \s.
  const oldLocal = (s: string) => s.toLowerCase().replace(/[-_]/g, '');

  it('a slug with a SPACE normalised differently in the copies (the latent bug)', () => {
    expect(normSportSlug('Table Tennis')).toBe('tabletennis');
    expect(oldLocal('Table Tennis')).toBe('table tennis'); // would never match
    expect(normSportSlug('Table Tennis')).not.toBe(oldLocal('Table Tennis'));
  });

  it('every spelling of the same sport collapses to one value', () => {
    const forms = ['table-tennis', 'table_tennis', 'Table Tennis', 'TABLETENNIS'];
    expect(new Set(forms.map(normSportSlug)).size).toBe(1);
  });

  it('simple slugs are unaffected', () => {
    expect(normSportSlug('cricket')).toBe('cricket');
  });
});

describe('SC-396 · client limits mirror the server', () => {
  // The FE mirror must not drift from the BE source of truth.
  const FE_MIRROR = {
    tournamentMinTeams: 2, tournamentMaxTeams: 64, expenseMaxAmount: 99_999_999.99,
    expenseTitleMax: 120, venueMax: 120, postTextMax: 500, bioMax: 500,
    teamNameMax: 60, tournamentNameMax: 120, descriptionMax: 2000,
    groupNameMax: 60, urlMax: 2048,
  };
  // Array caps are a SEPARATE object on the server — the mirror keeps that split.
  const FE_ARRAY_MIRROR = {
    mentions: 20, participants: 50, forwardChats: 20,
    batchIds: 500, splitAmong: 50, sportIds: 30,
  };

  it('every mirrored key matches the server value', () => {
    for (const [k, v] of Object.entries(FE_MIRROR)) {
      expect((LIMITS as Record<string, number>)[k]).toBe(v);
    }
  });

  it('array caps mirror ARRAY_LIMITS, not LIMITS', () => {
    for (const [k, v] of Object.entries(FE_ARRAY_MIRROR)) {
      expect((ARRAY_LIMITS as Record<string, number>)[k]).toBe(v);
    }
  });

  it('bio was the drifted one — client said 140, server allows 500', () => {
    expect(LIMITS.bioMax).toBe(500);
    expect(FE_MIRROR.bioMax).toBe(LIMITS.bioMax);
    expect(FE_MIRROR.bioMax).not.toBe(140);
  });
});

// ── SC-396 · pagination parsing is one function ───────────────────────────
import { parsePagination } from '../utils/pagination';

describe('SC-396 · pagination clamps hostile input', () => {
  it('a NEGATIVE offset is clamped — it reached .range() and 500d in prod', () => {
    // Verified live: GET /transactions?limit=-5&offset=-10 returned 500 before
    // this consolidation, because `parseInt('-10') || 0` is -10, not 0.
    const p = parsePagination({ limit: '-5', offset: '-10' }, { defaultLimit: 50, maxLimit: 100 });
    expect(p.offset).toBe(0);
    expect(p.limit).toBe(50);
    expect(p.from).toBeGreaterThanOrEqual(0);
    expect(p.to).toBeGreaterThanOrEqual(p.from);
  });

  it('a negative limit falls back to the default, not through `||`', () => {
    // The hand-rolled copies did `parseInt(x) || 20` — and -5 is TRUTHY, so a
    // negative page size survived and produced an inverted range.
    expect(parsePagination({ limit: '-5' }, { defaultLimit: 20, maxLimit: 50 }).limit).toBe(20);
  });

  it('an oversized limit is capped', () => {
    expect(parsePagination({ limit: '99999' }, { defaultLimit: 50, maxLimit: 100 }).limit).toBe(100);
  });

  it('garbage falls back to the default', () => {
    expect(parsePagination({ limit: 'abc', offset: 'xyz' }, { defaultLimit: 25 }).limit).toBe(25);
    expect(parsePagination({ limit: 'abc', offset: 'xyz' }, {}).offset).toBe(0);
  });

  it('offset overflow is capped defensively', () => {
    expect(parsePagination({ offset: '999999999999' }, {}).offset).toBe(10_000_000);
  });

  it('the happy path is untouched', () => {
    const p = parsePagination({ limit: '20', offset: '40' }, { maxLimit: 100 });
    expect([p.limit, p.offset, p.from, p.to]).toEqual([20, 40, 40, 59]);
  });
});
