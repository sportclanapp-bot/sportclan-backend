-- 037: atomic team captaincy transfer (Option A — single-captain invariant).
-- Hands captaincy from the current captain to another member and demotes the
-- old captain to player. The promote + demote is performed as ONE UPDATE
-- statement (a CASE over the two affected rows), so it is atomic by definition:
-- there is never an observable state with zero captains or two captains, even
-- under concurrency. This mirrors the coin economy's race-safe RPC pattern
-- (see 030_atomic_gift_deduct.sql) since supabase-js/PostgREST has no
-- multi-statement transactions.
--
-- Guards (all raise, rolling the call back — the caller maps these to HTTP):
--   TARGET_IS_ACTOR   — you are already the captain
--   ACTOR_NOT_MEMBER  — caller isn't on the team
--   ACTOR_NOT_CAPTAIN — caller isn't the current captain
--   TARGET_NOT_MEMBER — the promotee isn't on the team
-- Because the actor must already be the captain and the target becomes captain,
-- the team always retains exactly one captain (never left headless).
CREATE OR REPLACE FUNCTION transfer_team_captaincy(
  p_team_id UUID,
  p_actor_id UUID,
  p_target_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_actor_role TEXT;
  v_target_role TEXT;
BEGIN
  IF p_actor_id = p_target_id THEN
    RAISE EXCEPTION 'TARGET_IS_ACTOR';
  END IF;

  SELECT role INTO v_actor_role
  FROM team_members
  WHERE team_id = p_team_id AND user_id = p_actor_id;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'ACTOR_NOT_MEMBER';
  END IF;
  IF v_actor_role <> 'captain' THEN
    RAISE EXCEPTION 'ACTOR_NOT_CAPTAIN';
  END IF;

  SELECT role INTO v_target_role
  FROM team_members
  WHERE team_id = p_team_id AND user_id = p_target_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'TARGET_NOT_MEMBER';
  END IF;

  -- Single-statement swap: current captain -> player, target -> captain.
  UPDATE team_members
  SET role = CASE
    WHEN user_id = p_target_id THEN 'captain'
    WHEN role = 'captain' THEN 'player'
    ELSE role
  END
  WHERE team_id = p_team_id
    AND (user_id = p_target_id OR role = 'captain');
END;
$$ LANGUAGE plpgsql;
