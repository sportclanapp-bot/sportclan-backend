-- 117 · sports.display_order in the app's one sport order (Home's, Cricket first).
--
-- The 001 seed left Cricket, Football, Basketball, Badminton, … and Pickleball /
-- Carrom were appended at 12 and 13, so anything ordering by display_order listed
-- sports differently from the app. GET /sports now sorts in code as well
-- (src/constants/sportOrder.ts), so this is for every other reader of the column.
-- Idempotent: it only sets values. Kabaddi and athletics (inactive, SC-335) go last.

UPDATE sports SET display_order = CASE slug
  WHEN 'cricket'      THEN 1
  WHEN 'badminton'    THEN 2
  WHEN 'football'     THEN 3
  WHEN 'tennis'       THEN 4
  WHEN 'table-tennis' THEN 5
  WHEN 'pickleball'   THEN 6
  WHEN 'chess'        THEN 7
  WHEN 'carrom'       THEN 8
  WHEN 'volleyball'   THEN 9
  WHEN 'basketball'   THEN 10
  WHEN 'hockey'       THEN 11
  WHEN 'kabaddi'      THEN 12
  WHEN 'athletics'    THEN 13
  ELSE display_order
END;

-- Check:
--   SELECT slug, display_order, is_active FROM sports ORDER BY display_order;
