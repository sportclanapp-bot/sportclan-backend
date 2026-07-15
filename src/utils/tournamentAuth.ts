// Tournament authorization helpers (co-organisers + narrow admin override).
//
// The organiser set of a tournament = created_by ∪ tournament_organisers rows.
// OPERATIONAL actions (generate/reschedule/approve/direct-add/add-official/score/
// complete-or-cancel a MATCH) are allowed for any organiser — isTournamentOrganiser.
// CARVE-OUTS (manage co-organisers, cancel/force-complete/reassign the TOURNAMENT)
// are creator-only, OR an admin (attributed via admin_actions). A co-organiser
// canNOT do the carve-outs — they can't nuke the cup or lock the creator out.
import { supabase } from './supabase';

/** Creator OR a co-organiser row. NO admin (admins only get the narrow carve-outs). */
export async function isTournamentOrganiser(
  tournamentId: string | null | undefined,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!tournamentId || !userId) return false;
  const { data: t } = await supabase
    .from('tournaments').select('created_by').eq('id', tournamentId).maybeSingle();
  if (t?.created_by === userId) return true;
  const { data: co } = await supabase
    .from('tournament_organisers').select('user_id')
    .eq('tournament_id', tournamentId).eq('user_id', userId).maybeSingle();
  return !!co;
}

export async function userIsAdmin(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data } = await supabase.from('users').select('is_admin').eq('id', userId).maybeSingle();
    return (data as { is_admin?: boolean } | null)?.is_admin === true;
  } catch {
    return false;
  }
}

// Carve-out authorization: creator OR admin. Returns whether it's an ADMIN
// override so the caller can write the audit row (only admin-authorized writes
// are logged — a creator/co-org doing the same action is NOT logged).
export async function authorizeCarveout(
  tournamentCreatedBy: string | null | undefined,
  userId: string,
): Promise<{ ok: boolean; viaAdmin: boolean }> {
  if (tournamentCreatedBy && tournamentCreatedBy === userId) return { ok: true, viaAdmin: false };
  if (await userIsAdmin(userId)) return { ok: true, viaAdmin: true };
  return { ok: false, viaAdmin: false };
}

// Attribution for an admin override. Best-effort — never block the mutation on
// the audit insert (but the mutation only proceeds because is_admin authorized it).
export async function logAdminAction(
  adminUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  summary: string | null,
): Promise<void> {
  try {
    await supabase.from('admin_actions').insert({
      admin_user_id: adminUserId, action, target_type: targetType, target_id: targetId, summary,
    });
  } catch {
    // best-effort audit; do not fail the caller
  }
}

// OFFICIATING a match (score / toss / complete / abandon / set lineup):
//   tournament match → any organiser (creator/co-org) OR the assigned umpire
//   casual match     → creator OR the assigned umpire   (UNCHANGED)
// The assigned umpire may always officiate; the co-organiser extension only adds
// the tournament organiser set. (Structural gates — updateMatch/cancelMatch —
// don't use this: they're handled inline, because updateMatch keeps umpire for
// CASUAL matches only and cancelMatch never allows the umpire.)
export async function canOfficiateMatch(
  match: { tournament_id?: string | null; created_by?: string | null; umpire_id?: string | null },
  userId: string,
): Promise<boolean> {
  if (match.umpire_id && match.umpire_id === userId) return true;
  if (match.tournament_id) return isTournamentOrganiser(match.tournament_id, userId);
  return !!match.created_by && match.created_by === userId;
}
