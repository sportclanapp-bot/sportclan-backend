-- CHECK 094 - push tokens and receipts. Read-only.

-- BLOCK 1 - what tokens exist, and are they the shape Expo accepts?
-- Every row should be expo_format = tokens. The app has only ever produced
-- Expo tokens, so anything else is a foreign row worth a look.
SELECT platform,
       count(*)                                                  AS tokens,
       count(*) FILTER (WHERE token LIKE 'ExponentPushToken[%')  AS expo_format
FROM push_tokens
GROUP BY platform;

-- BLOCK 2 - after the phone test: the tester's device should have ONE row.
SELECT u.username, p.platform, left(p.token, 24) || '...' AS token, p.created_at
FROM push_tokens p JOIN users u ON u.id = p.user_id
WHERE u.username IN ('qaflow922_qa', 'sc434fresh_qa')
ORDER BY p.created_at DESC;

-- BLOCK 3 - receipts: tickets waiting, and tickets done. After the hourly job
-- runs, unchecked should be only those younger than 15 minutes.
SELECT count(*) FILTER (WHERE checked_at IS NULL)     AS unchecked,
       count(*) FILTER (WHERE checked_at IS NOT NULL) AS checked,
       min(created_at) FILTER (WHERE checked_at IS NULL) AS oldest_unchecked
FROM push_tickets;

-- BLOCK 4 - housekeeping to run occasionally: checked tickets older than a day
-- have nothing left to say. (This is the ONE write in this file; skip it if
-- you only want to look.)
-- DELETE FROM push_tickets WHERE checked_at IS NOT NULL AND created_at < now() - interval '1 day';
