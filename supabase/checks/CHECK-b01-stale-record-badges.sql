-- NOT RUN (decided 27 Sep 2026): test data only — every production row is
-- dummy/test data and the launch wipe removes it. Kept for reference; the code
-- now keeps real data correct as it is created and changed.

-- ===========================================================================
-- CHECK-b01 · after APPLY-b01. Read-only. Each block runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · No stale match/win badge remains. Expected: 0.
-- ---------------------------------------------------------------------------
WITH totals AS (
  SELECT user_id, SUM(matches_played) AS m, SUM(wins) AS w
  FROM user_sport_profiles GROUP BY user_id
)
SELECT count(*) AS stale_remaining
FROM user_badges ub
JOIN badges b ON b.id = ub.badge_id AND b.category IN ('matches', 'wins')
LEFT JOIN totals t ON t.user_id = ub.user_id
WHERE ub.revoked_at IS NULL
  AND ((b.category = 'matches' AND COALESCE(t.m, 0) < b.threshold)
    OR (b.category = 'wins'    AND COALESCE(t.w, 0) < b.threshold));


-- ---------------------------------------------------------------------------
-- BLOCK 2 · The four QA device accounts (baseline: 0 matches, 0 wins).
-- Expected: every matches/wins badge shows revoked = true (15 rows); other
-- categories, if any, show revoked = false. Nothing was deleted.
-- ---------------------------------------------------------------------------
SELECT u.username, b.slug, b.category, ub.revoked_at IS NOT NULL AS revoked, ub.revoke_reason
FROM user_badges ub
JOIN users u ON u.id = ub.user_id
JOIN badges b ON b.id = ub.badge_id
WHERE u.username IN ('qadev_a_qa', 'qadev_b_qa', 'qadev_c_qa', 'qadev_d_qa')
ORDER BY u.username, b.category;
