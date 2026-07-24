-- SC-347 · polls: single-choice vs multiple-choice.
--
-- allow_multiple: chosen by the author at create time (fixed thereafter).
-- poll_voter_count: distinct voters — the honest denominator in BOTH modes
--   (single: == sum of option counts; multi: option %s are share of distinct voters,
--   so they can sum to >100%). Denormalized + recomputed by apply_poll_vote_set so
--   the feed never has to count votes client-side.
ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS allow_multiple boolean NOT NULL DEFAULT false;
ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS poll_voter_count int NOT NULL DEFAULT 0;

-- A multi-choice voter needs ONE row per selected option, so widen the PK from
-- (post_id, user_id) → (post_id, user_id, option_id). Existing single-vote rows stay
-- unique. Single-choice "one vote per voter" is now enforced in apply_poll_vote_set
-- (it replaces the whole selection) + the controller (rejects >1 pick when single).
ALTER TABLE poll_votes DROP CONSTRAINT IF EXISTS poll_votes_pkey;
ALTER TABLE poll_votes ADD CONSTRAINT poll_votes_pkey PRIMARY KEY (post_id, user_id, option_id);

-- Set-based vote: replace this voter's ENTIRE selection with p_option_ids (empty =
-- remove their vote), then recompute per-option counts AND the distinct-voter count
-- from the authoritative poll_votes rows — all under a row lock (SC-61 pattern).
-- Coexists with the legacy apply_poll_vote(TEXT) by overload; the controller calls
-- this one. Single vs multi is decided by the caller (single passes a 1-element set).
CREATE OR REPLACE FUNCTION apply_poll_vote_set(
  p_post_id   UUID,
  p_user_id   UUID,
  p_option_ids TEXT[]
)
RETURNS SETOF community_posts AS $$
BEGIN
  PERFORM 1 FROM community_posts WHERE id = p_post_id FOR UPDATE;

  DELETE FROM poll_votes WHERE post_id = p_post_id AND user_id = p_user_id;
  IF array_length(p_option_ids, 1) IS NOT NULL THEN
    INSERT INTO poll_votes (post_id, user_id, option_id, created_at)
    SELECT p_post_id, p_user_id, unnest(p_option_ids), now();
  END IF;

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
      ),
      poll_voter_count = (
        SELECT count(DISTINCT user_id)::int FROM poll_votes WHERE post_id = p_post_id
      )
  WHERE p.id = p_post_id;

  RETURN QUERY SELECT * FROM community_posts WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql;
