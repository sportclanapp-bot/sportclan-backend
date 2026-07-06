-- 046: atomic captaincy transfer on account deletion (ports the SC-79 JS
-- resolveCaptainciesOnDelete to a DB function). For every team the deleted user
-- captains: promote the vice_captain if one exists, else the oldest remaining
-- member (min joined_at, tie-break user_id); a sole-member team has the
-- departing captain's membership removed (team goes inert). The whole function
-- runs in one implicit transaction, so it can never leave a team headless or
-- two-captained — even if the caller/process dies mid-run. The promote+demote
-- is a single-statement CASE UPDATE, mirroring 037_team_captaincy_transfer.
CREATE OR REPLACE FUNCTION finalize_captaincy_on_delete(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_team_id   UUID;
  v_successor UUID;
BEGIN
  FOR v_team_id IN
    SELECT team_id FROM team_members
    WHERE user_id = p_user_id AND role = 'captain'
  LOOP
    -- vice_captain first, else oldest remaining member (tie-break user_id)
    SELECT user_id INTO v_successor
    FROM team_members
    WHERE team_id = v_team_id AND user_id <> p_user_id
    ORDER BY (role = 'vice_captain') DESC, joined_at ASC, user_id ASC
    LIMIT 1;

    IF v_successor IS NULL THEN
      -- sole member: remove the departing captain; team goes inert
      DELETE FROM team_members WHERE team_id = v_team_id AND user_id = p_user_id;
    ELSE
      -- single-statement swap: successor -> captain, departing captain -> player
      UPDATE team_members
      SET role = CASE
        WHEN user_id = v_successor THEN 'captain'
        WHEN user_id = p_user_id  THEN 'player'
        ELSE role
      END
      WHERE team_id = v_team_id
        AND (user_id = v_successor OR user_id = p_user_id);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
