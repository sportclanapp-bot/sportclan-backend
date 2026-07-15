// Team authorization helpers (co-captains — SC-267).
//
// A team's MANAGER set = the captain (team_members.role='captain', the single-
// captain invariant SC-103) ∪ its co-captains (role='vice_captain'). Managers do
// all OPERATIONAL actions (add/remove players, edit the team, enter/withdraw a
// tournament, approve/reject join requests). CARVE-OUTS stay captain-only:
// manage co-captains (promote/demote), transfer captaincy, disband, and removing
// the captain or another co-captain. Those use isTeamCaptain, not isTeamManager.
//
// NB: co-captain reuses the EXISTING 'vice_captain' role — already in the mig 004
// CHECK and already the captaincy heir in RPCs 037/046. SC-267 gives it authority.
import { supabase } from './supabase';

export type TeamRole = 'captain' | 'vice_captain' | 'player';

/** The caller's role on a team, or null if not a member. */
export async function getTeamRole(
  teamId: string | null | undefined,
  userId: string | null | undefined,
): Promise<TeamRole | null> {
  if (!teamId || !userId) return null;
  const { data } = await supabase
    .from('team_members').select('role')
    .eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  return (data?.role as TeamRole | undefined) ?? null;
}

/** Manager = captain OR co-captain (vice_captain). Drives the operational gates. */
export async function isTeamManager(
  teamId: string | null | undefined,
  userId: string | null | undefined,
): Promise<boolean> {
  const role = await getTeamRole(teamId, userId);
  return role === 'captain' || role === 'vice_captain';
}

/** Strict captain — the carve-out authority (manage co-captains / transfer / disband). */
export async function isTeamCaptain(
  teamId: string | null | undefined,
  userId: string | null | undefined,
): Promise<boolean> {
  return (await getTeamRole(teamId, userId)) === 'captain';
}
