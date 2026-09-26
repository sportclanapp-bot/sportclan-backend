-- ===========================================================================
-- APPLY-b01 · remove match/win badges that voided matches no longer earn
-- Visual review V042, decision D6 (revoke silently; a restore re-awards).
--
-- From BE-1 on, voiding a match revokes these as it happens
-- (badges.controller.ts:revokeRecordBadgesForUser). This clears the ones that
-- went stale BEFORE that code existed. The rule is the code's rule exactly:
-- a 'matches' badge needs SUM(matches_played) >= threshold, a 'wins' badge
-- needs SUM(wins) >= threshold, summed over the user's sport profiles.
--
-- Only the two record categories. Community, general and sport-specific badges
-- are not touched (a void can't move them; some were seeded by hand).
--
-- Each block runs on its own. Run 1, then 2 (review the list), then 3.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · COUNT FIRST (read-only): how many rows would go, per badge.
-- ---------------------------------------------------------------------------
WITH totals AS (
  SELECT user_id, SUM(matches_played) AS m, SUM(wins) AS w
  FROM user_sport_profiles GROUP BY user_id
)
SELECT b.slug, b.category, b.threshold, count(*) AS stale_rows
FROM user_badges ub
JOIN badges b ON b.id = ub.badge_id AND b.category IN ('matches', 'wins')
LEFT JOIN totals t ON t.user_id = ub.user_id
WHERE (b.category = 'matches' AND COALESCE(t.m, 0) < b.threshold)
   OR (b.category = 'wins'    AND COALESCE(t.w, 0) < b.threshold)
GROUP BY b.slug, b.category, b.threshold
ORDER BY b.category, b.threshold;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · The affected people (read-only), test accounts marked. Review.
-- ---------------------------------------------------------------------------
WITH totals AS (
  SELECT user_id, SUM(matches_played) AS m, SUM(wins) AS w
  FROM user_sport_profiles GROUP BY user_id
)
SELECT u.username, u.email LIKE '%sportclan.test' AS test_account,
       COALESCE(t.m, 0) AS matches, COALESCE(t.w, 0) AS wins,
       string_agg(b.slug, ', ' ORDER BY b.category, b.threshold) AS badges_to_remove
FROM user_badges ub
JOIN badges b ON b.id = ub.badge_id AND b.category IN ('matches', 'wins')
JOIN users u ON u.id = ub.user_id
LEFT JOIN totals t ON t.user_id = ub.user_id
WHERE (b.category = 'matches' AND COALESCE(t.m, 0) < b.threshold)
   OR (b.category = 'wins'    AND COALESCE(t.w, 0) < b.threshold)
GROUP BY u.username, u.email, t.m, t.w
ORDER BY test_account, u.username;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · Delete them. Returns the number removed; it should equal the sum
-- of stale_rows in block 1.
-- ---------------------------------------------------------------------------
WITH totals AS (
  SELECT user_id, SUM(matches_played) AS m, SUM(wins) AS w
  FROM user_sport_profiles GROUP BY user_id
), gone AS (
  DELETE FROM user_badges ub
  USING badges b
  WHERE b.id = ub.badge_id
    AND b.category IN ('matches', 'wins')
    AND (
      (b.category = 'matches' AND COALESCE((SELECT m FROM totals WHERE totals.user_id = ub.user_id), 0) < b.threshold)
   OR (b.category = 'wins'    AND COALESCE((SELECT w FROM totals WHERE totals.user_id = ub.user_id), 0) < b.threshold)
    )
  RETURNING ub.id
)
SELECT count(*) AS removed FROM gone;
