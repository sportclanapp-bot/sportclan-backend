-- 171 · Fix list 25 Nov 2026, items 8 + 9 (speed). Two functions, server only; changes no rows by itself; safe to run twice.
-- 8: for each of these chats: its people, its last message and the viewer's unread count, in one call
-- (it was three reads a chat: 257 for a page of 50). The same rules as messages.controller listChats.
CREATE OR REPLACE FUNCTION public.chat_list_extras(p_user uuid, p_chats uuid[], p_blocked uuid[], p_cap integer) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('chat_id', c.id, 'participants', p.people, 'last', l.msg, 'unread', COALESCE(u.n, 0))), '[]'::jsonb)
  FROM unnest(p_chats) AS c(id)
  LEFT JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', cp.user_id, 'role', cp.role,
             'user', CASE WHEN us.id IS NULL THEN NULL ELSE jsonb_build_object('id', us.id, 'name', us.name, 'username', us.username, 'profile_picture_url', us.profile_picture_url) END)
             ORDER BY cp.joined_at, cp.id), '[]'::jsonb) AS people
    FROM chat_participants cp LEFT JOIN users us ON us.id = cp.user_id
    WHERE cp.chat_id = c.id AND cp.left_at IS NULL
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object('id', m.id, 'content', m.content, 'sender_id', m.sender_id, 'created_at', m.created_at, 'is_system', m.is_system,
             'sender', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id', s.id, 'name', s.name, 'username', s.username) END) AS msg
    FROM messages m LEFT JOIN users s ON s.id = m.sender_id
    WHERE m.chat_id = c.id AND m.is_deleted = false
    ORDER BY m.created_at DESC
    LIMIT 1
  ) l ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n
    FROM (
      SELECT m.sender_id FROM messages m
      WHERE m.chat_id = c.id AND m.sender_id <> p_user AND m.is_deleted = false
        AND NOT (m.read_by @> ARRAY[p_user]) AND NOT (m.sender_id = ANY (COALESCE(p_blocked, '{}'::uuid[])))
      LIMIT p_cap
    ) x
    WHERE NOT EXISTS (SELECT 1 FROM users d WHERE d.id = x.sender_id AND d.deleted_at IS NOT NULL)
  ) u ON true;
$$;
REVOKE ALL ON FUNCTION public.chat_list_extras(uuid, uuid[], uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_list_extras(uuid, uuid[], uuid[], integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_list_extras(uuid, uuid[], uuid[], integer) TO service_role;

-- 9: "delivered" for the viewer's newest undelivered messages in their chats, in one update (it was up to
-- 500 updates one by one, each rewriting the list it had read: two phones at once could lose one).
CREATE OR REPLACE FUNCTION public.mark_messages_delivered(p_user uuid, p_limit integer) RETURNS integer
LANGUAGE sql VOLATILE
SET search_path = public
AS $$
  WITH due AS (
    SELECT m.id FROM messages m
    JOIN chat_participants cp ON cp.chat_id = m.chat_id AND cp.user_id = p_user AND cp.left_at IS NULL
    WHERE m.sender_id <> p_user AND NOT (m.delivered_to @> ARRAY[p_user])
    ORDER BY m.created_at DESC
    LIMIT p_limit
  ), done AS (
    UPDATE messages m SET delivered_to = array_append(m.delivered_to, p_user)
    FROM due WHERE m.id = due.id AND NOT (m.delivered_to @> ARRAY[p_user])
    RETURNING 1
  )
  SELECT count(*)::int FROM done;
$$;
REVOKE ALL ON FUNCTION public.mark_messages_delivered(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_messages_delivered(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_messages_delivered(uuid, integer) TO service_role;
