-- 041: atomic poll vote + count recompute (SC-61 — vote-count drift fix).
-- votePoll upserted the poll_votes row, then in a SEPARATE statement read ALL
-- poll_votes, recomputed the denormalized community_posts.poll_options[].vote_count
-- in JS, and wrote the whole JSONB back. Under concurrency this read-all-recompute-
-- write lost updates: two votes could read the same tally and both write it back,
-- leaving the cached counts below the true poll_votes count. (The poll_votes rows
-- themselves were always correct.)
--
-- This function does the upsert AND the recompute in ONE transaction, taking a
-- row lock on the post (SELECT ... FOR UPDATE) so concurrent votes on the same
-- poll serialize. The counts are recomputed directly from poll_votes in SQL, so
-- the denormalized poll_options counts always equal the authoritative tally.
-- Returns the updated community_posts row.
CREATE OR REPLACE FUNCTION apply_poll_vote(
  p_post_id  UUID,
  p_user_id  UUID,
  p_option_id TEXT
)
RETURNS SETOF community_posts AS $$
BEGIN
  -- Lock the post row; concurrent votes on this poll queue behind this.
  PERFORM 1 FROM community_posts WHERE id = p_post_id FOR UPDATE;

  INSERT INTO poll_votes (post_id, user_id, option_id, created_at)
  VALUES (p_post_id, p_user_id, p_option_id, now())
  ON CONFLICT (post_id, user_id)
  DO UPDATE SET option_id = EXCLUDED.option_id, created_at = now();

  -- Recompute every option's vote_count from the authoritative poll_votes rows,
  -- preserving option id / text / order.
  UPDATE community_posts p
  SET poll_options = (
    SELECT jsonb_agg(
             jsonb_build_object(
               'id', o.opt->>'id',
               'text', o.opt->>'text',
               'vote_count', COALESCE(cnt.c, 0)
             ) ORDER BY o.ord
           )
    FROM jsonb_array_elements(p.poll_options) WITH ORDINALITY AS o(opt, ord)
    LEFT JOIN (
      SELECT option_id, count(*)::int AS c
      FROM poll_votes
      WHERE post_id = p_post_id
      GROUP BY option_id
    ) cnt ON cnt.option_id = o.opt->>'id'
  )
  WHERE p.id = p_post_id;

  RETURN QUERY SELECT * FROM community_posts WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql;
