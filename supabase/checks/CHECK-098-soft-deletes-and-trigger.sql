-- ===========================================================================
-- CHECK-098 · after migration 098. Each block runs on its own.
-- Blocks 1–2 only read. Block 3 writes inside a block that always ends by
-- raising, so everything it did is rolled back and nothing persists.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · nothing test-made is left unflagged.
-- Expected: all zeros.
-- ---------------------------------------------------------------------------
WITH tu AS (SELECT id FROM users WHERE is_test_seed)
SELECT
  (SELECT count(*) FROM teams           WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu)) AS teams,
  (SELECT count(*) FROM tournaments     WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu)) AS tournaments,
  (SELECT count(*) FROM matches         WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu)) AS matches,
  (SELECT count(*) FROM community_posts WHERE NOT is_test_seed AND author_id  IN (SELECT id FROM tu)) AS posts,
  (SELECT count(*) FROM chats           WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu)) AS chats,
  (SELECT count(*) FROM venues          WHERE NOT is_test_seed AND created_by IN (SELECT id FROM tu)) AS venues;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · READ-ONLY · the new columns start empty (no row is revoked, left
-- or deleted by the migration itself). Expected: all zeros until someone acts.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM user_badges       WHERE revoked_at IS NOT NULL) AS revoked_badges,
  (SELECT count(*) FROM chat_participants WHERE left_at    IS NOT NULL) AS left_members,
  (SELECT count(*) FROM chats             WHERE deleted_at IS NOT NULL) AS deleted_chats;


-- ---------------------------------------------------------------------------
-- BLOCK 3 · the trigger, rolled back. A venue created by a test account is
-- flagged; one created by dipak is not.
-- Expected: ERROR "CHECK-098 PASS · test-made venue flagged, real one not"
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  qa uuid := (SELECT id FROM users WHERE username = 'qadev_a_qa');
  me uuid := (SELECT id FROM users WHERE username = 'dipak');
  f1 boolean; f2 boolean;
BEGIN
  INSERT INTO venues (name, created_by) VALUES ('CHECK-098 test venue', qa) RETURNING is_test_seed INTO f1;
  INSERT INTO venues (name, created_by) VALUES ('CHECK-098 real venue', me) RETURNING is_test_seed INTO f2;
  IF f1 AND NOT f2 THEN
    RAISE EXCEPTION 'CHECK-098 PASS · test-made venue flagged, real one not';
  END IF;
  RAISE EXCEPTION 'CHECK-098 FAIL · test=% real=%', f1, f2;
END $$;


-- ---------------------------------------------------------------------------
-- BLOCK 4 · the trigger on ALL SIX tables, with their real columns, rolled
-- back. For each table a scratch TEMP copy (LIKE public.<table>, so it has the
-- production columns and defaults; NOT NULLs relaxed so one column is enough)
-- gets the trigger, and two rows are inserted: one by a test account
-- (qadev_a_qa, must be flagged) and one by dipak (must not be). Then a match
-- by dipak inside a flagged tournament (must be flagged). Every INSERT must
-- succeed — this is the check that NEW.<missing column> can't break one.
-- Nothing persists: the block always ends by raising.
-- Expected: ERROR "CHECK-098 PASS · 6 tables × test/real creator, and a match in a test tournament"
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  qa uuid := (SELECT id FROM public.users WHERE username = 'qadev_a_qa');
  me uuid := (SELECT id FROM public.users WHERE username = 'dipak');
  ft uuid := (SELECT id FROM public.tournaments WHERE is_test_seed LIMIT 1);
  t text; c text; col record; r_qa boolean; r_me boolean;
BEGIN
  IF qa IS NULL OR me IS NULL OR ft IS NULL THEN
    RAISE EXCEPTION 'CHECK-098 FAIL · setup: qa=% dipak=% flagged tournament=%', qa, me, ft;
  END IF;
  FOREACH t IN ARRAY ARRAY['teams', 'tournaments', 'matches', 'community_posts', 'chats', 'venues'] LOOP
    EXECUTE format('CREATE TEMP TABLE %I (LIKE public.%I INCLUDING DEFAULTS)', 'chk_' || t, t);
    FOR col IN
      SELECT attname FROM pg_attribute
      WHERE attrelid = format('pg_temp.%I', 'chk_' || t)::regclass AND attnum > 0 AND NOT attisdropped AND attnotnull
    LOOP
      EXECUTE format('ALTER TABLE pg_temp.%I ALTER COLUMN %I DROP NOT NULL', 'chk_' || t, col.attname);
    END LOOP;
    EXECUTE format('CREATE TRIGGER chk BEFORE INSERT ON pg_temp.%I FOR EACH ROW EXECUTE FUNCTION public.flag_test_content_on_insert()', 'chk_' || t);
    c := CASE WHEN t = 'community_posts' THEN 'author_id' ELSE 'created_by' END;
    EXECUTE format('INSERT INTO pg_temp.%I (%I) VALUES ($1) RETURNING is_test_seed', 'chk_' || t, c) INTO r_qa USING qa;
    EXECUTE format('INSERT INTO pg_temp.%I (%I) VALUES ($1) RETURNING is_test_seed', 'chk_' || t, c) INTO r_me USING me;
    IF NOT r_qa OR r_me THEN
      RAISE EXCEPTION 'CHECK-098 FAIL · %: test creator flagged=%, real creator flagged=%', t, r_qa, r_me;
    END IF;
  END LOOP;
  EXECUTE 'INSERT INTO pg_temp.chk_matches (created_by, tournament_id) VALUES ($1, $2) RETURNING is_test_seed'
    INTO r_me USING me, ft;
  IF NOT r_me THEN
    RAISE EXCEPTION 'CHECK-098 FAIL · a match in a flagged tournament was not flagged';
  END IF;
  RAISE EXCEPTION 'CHECK-098 PASS · 6 tables × test/real creator, and a match in a test tournament';
END $$;
