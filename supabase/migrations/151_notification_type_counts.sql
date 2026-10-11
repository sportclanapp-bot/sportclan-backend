-- 151 · Audit #143 (11 Oct 2026): the Notifications filter chips read "Social · 0+",
-- "Gifts · 0+", "All · 1000+" beside "Matches · 999+" — the server counted the
-- types of only the newest 1,000 notifications. This counts every one, by type,
-- in one query (the user's rows through idx_notifications_user). Server-only.
-- Additive and safe to run twice: a new function, nothing else changes.
CREATE OR REPLACE FUNCTION notification_type_counts(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(t, n), '{}'::jsonb)
  FROM (
    SELECT COALESCE(type, 'other') AS t, count(*) AS n
    FROM notifications
    WHERE user_id = p_user AND hidden_at IS NULL
    GROUP BY 1
  ) c;
$$;

REVOKE ALL ON FUNCTION notification_type_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_type_counts(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION notification_type_counts(uuid) TO service_role;
