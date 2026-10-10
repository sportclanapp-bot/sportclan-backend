/**
 * B04 (V006, V252, decision D1) · "Your next match" on Home.
 *
 * `/matches?mine=1` means matches you CREATED, so a player added to someone
 * else's match, or a member of a team with a fixture, had no way to see it on
 * Home. A match is yours here when any of these holds:
 *   - you are in its line-up (match_participants — singles, pickup, set line-ups);
 *   - you are on the roster of either team;
 *   - you created it (the person who has to start or reschedule it).
 * Only scheduled, unvoided matches. Live ones already have Home's ticker.
 */
import { supabase } from './supabase';

/** A fixture this far past its start still counts as "now" (a late start). */
export const NEXT_MATCH_GRACE_HOURS = 6;

interface Row { id: string; scheduled_at: string | null }

/**
 * The one match to show. In order: one that started within the grace window
 * (you are probably about to play it), else the soonest one ahead, else the most
 * recent one whose time has passed — which Home marks "Overdue".
 */
export function pickNextMatch<T extends Row>(rows: T[], now = Date.now()): { match: T | null; overdue: boolean } {
  const dated = rows
    .filter((r) => r.scheduled_at)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const graceStart = now - NEXT_MATCH_GRACE_HOURS * 3600_000;
  const current = dated.find((r) => new Date(r.scheduled_at!).getTime() >= graceStart);
  if (current) return { match: current, overdue: new Date(current.scheduled_at!).getTime() < now };
  const lastPast = dated[dated.length - 1];
  return lastPast ? { match: lastPast, overdue: true } : { match: null, overdue: false };
}

/** Every scheduled, unvoided match the user plays in or created. */
export async function myScheduledMatches(userId: string): Promise<any[]> {
  const [partsRes, teamsRes] = await Promise.all([
    supabase.from('match_participants').select('match_id').eq('user_id', userId),
    supabase.from('team_members').select('team_id').eq('user_id', userId),
  ]);
  const partIds = Array.from(new Set((partsRes.data ?? []).map((r: { match_id: string }) => r.match_id)));
  const teamIds = Array.from(new Set((teamsRes.data ?? []).map((r: { team_id: string }) => r.team_id)));

  const base = () => supabase.from('matches').select('*').eq('status', 'scheduled').is('voided_at', null);
  // Stage 16 (found on the device pass): someone in 200+ teams made one URL too long for
  // the database proxy, and the call failed; the teams go 100 at a time, like the match ids.
  const reads = [base().eq('created_by', userId)];
  for (let i = 0; i < teamIds.length; i += 100) {
    const ids = teamIds.slice(i, i + 100).join(',');
    reads.push(base().or(`team_a_id.in.(${ids}),team_b_id.in.(${ids})`));
  }
  for (let i = 0; i < partIds.length; i += 200) reads.push(base().in('id', partIds.slice(i, i + 200)));
  const results = await Promise.all(reads);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
  const byId = new Map<string, any>();
  for (const r of results) for (const m of r.data ?? []) byId.set(m.id, m);
  return [...byId.values()];
}
