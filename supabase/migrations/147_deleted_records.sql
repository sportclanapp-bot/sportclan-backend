-- 147 · Audit #23–#25 (11 Oct 2026, Dipak's decision 4): no user data is hard
-- deleted any more. Every row deleted from a user-data table is first copied,
-- whole, into deleted_records with when (deleted_at), who (deleted_by) and why
-- (deleted_reason), then leaves the live table — so every read skips it with no
-- change to the reads, and it can be put back. Credentials and short-lived
-- locks (otp_codes, refresh_tokens, push_tokens, scoring leases,
-- notification_sends) are not archived: copying codes and tokens would be a
-- leak, and they are not records. Additive; safe to run twice.
CREATE TABLE IF NOT EXISTS deleted_records (
  id             bigserial PRIMARY KEY,
  table_name     text        NOT NULL,
  row_id         text,
  row            jsonb       NOT NULL,
  deleted_at     timestamptz NOT NULL DEFAULT now(),
  deleted_by     uuid,
  deleted_reason text
);
CREATE INDEX IF NOT EXISTS deleted_records_table_row_idx ON deleted_records (table_name, row_id);
CREATE INDEX IF NOT EXISTS deleted_records_deleted_at_idx ON deleted_records (deleted_at);

CREATE OR REPLACE FUNCTION archive_deleted_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO deleted_records (table_name, row_id, row, deleted_by, deleted_reason)
  VALUES (
    TG_TABLE_NAME,
    to_jsonb(OLD) ->> 'id',
    to_jsonb(OLD),
    NULLIF(current_setting('app.deleted_by', true), '')::uuid,
    NULLIF(current_setting('app.deleted_reason', true), '')
  );
  RETURN OLD;
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'team_members', 'team_expenses', 'team_bans', 'team_join_requests',
    'notifications', 'invites', 'user_reviews',
    'tournament_organisers', 'tournament_officials', 'tournaments', 'teams',
    'matches', 'match_participants', 'match_events', 'rating_history',
    'follow_relationships', 'user_blocks', 'post_likes', 'profile_post_likes',
    'match_followers', 'user_sports', 'user_account_types'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS archive_on_delete ON public.%I', t);
      EXECUTE format('CREATE TRIGGER archive_on_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION archive_deleted_row()', t);
    END IF;
  END LOOP;
END
$$;

-- The deletes the audit named say who and why: one call, one transaction.
CREATE OR REPLACE FUNCTION delete_with_reason(p_table text, p_ids uuid[], p_by uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF NOT (p_table = ANY (ARRAY[
    'team_members', 'team_expenses', 'team_bans', 'team_join_requests',
    'notifications', 'invites', 'user_reviews',
    'tournament_organisers', 'tournament_officials', 'tournaments', 'teams',
    'matches', 'match_participants', 'match_events', 'rating_history'
  ])) THEN
    RAISE EXCEPTION 'delete_with_reason: % is not an archived table', p_table;
  END IF;
  PERFORM set_config('app.deleted_by', COALESCE(p_by::text, ''), true);
  PERFORM set_config('app.deleted_reason', COALESCE(p_reason, ''), true);
  EXECUTE format('DELETE FROM public.%I WHERE id = ANY ($1)', p_table) USING p_ids;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION delete_with_reason(text, uuid[], uuid, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION delete_with_reason(text, uuid[], uuid, text) TO service_role;
    GRANT ALL ON deleted_records TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE deleted_records_id_seq TO service_role;
  END IF;
END $$;
