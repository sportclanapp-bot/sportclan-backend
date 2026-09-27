/**
 * Hard-delete list #6 (27 Sep 2026) · a disbanded team is marked, not removed
 * (migration 106).
 *
 * The captain disbanding (DELETE /teams/:id) and the last member leaving used
 * to delete the team, its members and every expense record. The team row now
 * stays with deleted_at / deleted_by / deleted_reason ('captain_disband' |
 * 'last_member_left'); its members (now former members) and its expenses stay.
 * Former members can still read the expense history. Everything else about
 * the team answers "This team was disbanded" — no joining, inviting, invite
 * code, editing, or expense changes — and it is in no list, search or picker.
 */
import { Request, Response, NextFunction } from 'express';
import { supabase } from './supabase';

export const TEAM_DISBANDED = { error: 'This team was disbanded', code: 'TEAM_DISBANDED' } as const;

export type TeamDisbandReason = 'captain_disband' | 'last_member_left';

/** Only teams that are not disbanded. Applied to every list, search and picker. */
export function liveTeams<Q>(q: Q): Q {
  return (q as unknown as { is: (c: string, v: null) => Q }).is('deleted_at', null);
}

/** Is this team disbanded? null when it doesn't exist. */
export async function isTeamDisbanded(id: string): Promise<boolean | null> {
  const { data } = await supabase.from('teams').select('deleted_at').eq('id', id).maybeSingle();
  if (!data) return null;
  return !!(data as { deleted_at?: string | null }).deleted_at;
}

/** The disbanded ones among these team ids. */
export async function disbandedTeamIds(ids: string[]): Promise<Set<string>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (clean.length === 0) return new Set();
  const { data } = await supabase.from('teams').select('id').in('id', clean).not('deleted_at', 'is', null);
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}

/**
 * Mark a team disbanded — who, when, and how. Its members and expenses are
 * left exactly as they are. False when it was already disbanded or missing.
 */
export async function softDisbandTeam(id: string, by: string, reason: TeamDisbandReason): Promise<boolean> {
  const { data, error } = await supabase
    .from('teams')
    .update({ deleted_at: new Date().toISOString(), deleted_by: by, deleted_reason: reason })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id');
  if (error) throw error;
  return !!data && data.length > 0;
}

/**
 * Route guard for /teams/:id/… — a disbanded team answers 410 "This team was
 * disbanded". Mounted on every team route except the team page itself (which
 * says whether you were a member), the three expense READS (former members
 * keep the history), and withdrawing your own pending join request.
 */
export async function refuseDisbandedTeam(req: Request, res: Response, next: NextFunction) {
  const id = req.params.id;
  if (id && (await isTeamDisbanded(id))) return res.status(410).json(TEAM_DISBANDED);
  return next();
}
