// Tournament authorization helpers (co-organisers + narrow admin override).
//
// The organiser set of a tournament = created_by ∪ tournament_organisers rows.
// OPERATIONAL actions (generate/reschedule/approve/direct-add/add-official/score/
// complete-or-cancel a MATCH) are allowed for any organiser — isTournamentOrganiser.
// CARVE-OUTS (manage co-organisers, cancel/force-complete/reassign the TOURNAMENT)
// are creator-only, OR an admin (attributed via admin_actions). A co-organiser
// canNOT do the carve-outs — they can't nuke the cup or lock the creator out.
import { supabase } from './supabase';
import { familyLookupIds } from './tournamentEvents';

/** Creator OR a co-organiser row. NO admin (admins only get the narrow carve-outs). */
export async function isTournamentOrganiser(
  tournamentId: string | null | undefined,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!tournamentId || !userId) return false;
  const { data: t } = await supabase
    .from('tournaments').select('created_by, parent_id').eq('id', tournamentId).maybeSingle();
  if (t?.created_by === userId) return true;
  // Badminton gap 1: an event's organisers are its tournament's (kept on the parent).
  const ids = t?.parent_id ? [tournamentId, t.parent_id as string] : [tournamentId];
  const { data: co } = await supabase
    .from('tournament_organisers').select('user_id')
    .in('tournament_id', ids).eq('user_id', userId).limit(1);
  return (co ?? []).length > 0;
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
//
// Cricket gap 3 (5 Oct 2026): SCORERS too — the scorer the organiser named for
// this fixture (matches.scorer_id), and a tournament official with the scorer
// role, who may score every fixture of that tournament. They score, toss, set
// line-ups, complete and abandon like the umpire; voiding stays with the
// organiser, umpire or an admin ({ scorers: false }).
export async function canOfficiateMatch(
  match: { tournament_id?: string | null; created_by?: string | null; umpire_id?: string | null; scorer_id?: string | null },
  userId: string,
  opts: { scorers?: boolean } = {},
): Promise<boolean> {
  if (match.umpire_id && match.umpire_id === userId) return true;
  const scorers = opts.scorers !== false;
  if (scorers && match.scorer_id && match.scorer_id === userId) return true;
  if (match.tournament_id) {
    if (await isTournamentOrganiser(match.tournament_id, userId)) return true;
    return scorers && isTournamentScorer(match.tournament_id, userId);
  }
  return !!match.created_by && match.created_by === userId;
}

/** Cricket gap 3: a tournament official with the scorer role (scores every fixture). */
export async function isTournamentScorer(tournamentId: string, userId: string): Promise<boolean> {
  if (!tournamentId || !userId) return false;
  // Badminton gap 1: a tournament's officials work every one of its events.
  const ids = await familyLookupIds(tournamentId);
  const { data } = await supabase
    .from('tournament_officials')
    .select('id')
    .in('tournament_id', ids)
    .eq('user_id', userId)
    .in('role', ['scorer', 'pairings', 'sector', 'fair_play']) // Stage 12 · CH11: chess's pairings, sector and anti-cheating arbiters enter results too
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Stage 9 · T9 · who may default a player or side: the match's umpire, the
 * organiser (a casual match: its creator), or a tournament official who referees
 * or umpires — not a scorer (in tennis only the referee defaults).
 */
export async function canDefault(
  match: { tournament_id?: string | null; created_by?: string | null; umpire_id?: string | null; scorer_id?: string | null },
  userId: string,
): Promise<boolean> {
  if (await canOfficiateMatch(match, userId, { scorers: false })) return true;
  if (!match.tournament_id) return false;
  const ids = await familyLookupIds(match.tournament_id);
  const { data } = await supabase.from('tournament_officials').select('id')
    .in('tournament_id', ids).eq('user_id', userId).in('role', ['referee', 'umpire', 'chief_referee', 'deputy_referee', 'sector']).limit(1); // TT12: the tournament's referee and deputy · CH11: a sector arbiter
  return (data ?? []).length > 0;
}

/** Stage 12 · CH2 · a Swiss takes late entries while it has rounds still to pair (they score nothing — or half — for the rounds missed). */
export function swissTakesLateEntries(t: { format?: string | null; settings?: unknown }): boolean {
  if (t.format !== 'swiss') return false;
  const sw = (t.settings && typeof t.settings === 'object' ? (t.settings as { swiss?: { rounds?: number; paired?: number } }).swiss : null) ?? null;
  return !sw || (sw.paired ?? 0) < (sw.rounds ?? 0);
}
