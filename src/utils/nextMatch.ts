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
import { selectAll } from './selectAll';

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

/** Why a match is "yours" (N-R7-267): you play in it / created it, or you only follow it. */
export type MyMatchRelation = 'plays' | 'created' | 'follows';

/**
 * Every unvoided match with `status` that the user plays in (line-up or a team's
 * roster), created, or — with `followed` — follows. Each row carries `relation`.
 *
 * N-R7-267 (Step 2 B10, SP-VBL-C15): Home's live ticker asked `/matches?mine=1`,
 * which is matches you CREATED, so a player on either team of a live match had
 * no ticker for it and, with thousands of other live matches, could not find it
 * on Home at all. Every read here goes 1000 rows at a time (no caps).
 */
export async function myMatchesWithStatus(
  userId: string,
  status: 'scheduled' | 'live',
  opts: { followed?: boolean } = {},
): Promise<any[]> {
  const [parts, teams, follows] = await Promise.all([
    selectAll<{ match_id: string }>((from, to) => supabase.from('match_participants').select('match_id').eq('user_id', userId).order('match_id').range(from, to)),
    selectAll<{ team_id: string }>((from, to) => supabase.from('team_members').select('team_id').eq('user_id', userId).order('team_id').range(from, to)),
    opts.followed
      ? selectAll<{ match_id: string }>((from, to) => supabase.from('match_followers').select('match_id').eq('user_id', userId).order('match_id').range(from, to))
      : Promise.resolve([] as { match_id: string }[]),
  ]);
  const partIds = Array.from(new Set(parts.map((r) => r.match_id).filter(Boolean)));
  const teamIds = Array.from(new Set(teams.map((r) => r.team_id).filter(Boolean)));
  const followIds = Array.from(new Set(follows.map((r) => r.match_id).filter(Boolean)));

  const all = (narrow: (q: any) => any) => selectAll<any>((from, to) =>
    narrow(supabase.from('matches').select('*').eq('status', status).is('voided_at', null)).order('id').range(from, to));
  // Stage 16 (found on the device pass): someone in 200+ teams made one URL too long for
  // the database proxy, and the call failed; the teams go 100 at a time, like the match ids.
  const plays: Promise<any[]>[] = [];
  for (let i = 0; i < teamIds.length; i += 100) {
    const chunk = teamIds.slice(i, i + 100).join(',');
    plays.push(all((q) => q.or(`team_a_id.in.(${chunk}),team_b_id.in.(${chunk})`)));
  }
  for (let i = 0; i < partIds.length; i += 200) {
    const chunk = partIds.slice(i, i + 200);
    plays.push(all((q) => q.in('id', chunk)));
  }
  const followReads: Promise<any[]>[] = [];
  for (let i = 0; i < followIds.length; i += 200) {
    const chunk = followIds.slice(i, i + 200);
    followReads.push(all((q) => q.in('id', chunk)));
  }
  const [created, playRows, followRows] = await Promise.all([
    all((q) => q.eq('created_by', userId)),
    Promise.all(plays).then((r) => r.flat()),
    Promise.all(followReads).then((r) => r.flat()),
  ]);
  const byId = new Map<string, any>();
  // The strongest tie wins: playing in it, then having created it, then following it.
  for (const m of followRows) byId.set(m.id, { ...m, relation: 'follows' as MyMatchRelation });
  for (const m of created) byId.set(m.id, { ...m, relation: 'created' as MyMatchRelation });
  for (const m of playRows) byId.set(m.id, { ...m, relation: 'plays' as MyMatchRelation });
  return [...byId.values()];
}

/** Every scheduled, unvoided match the user plays in or created. */
export async function myScheduledMatches(userId: string): Promise<any[]> {
  return myMatchesWithStatus(userId, 'scheduled');
}

const RANK: Record<MyMatchRelation, number> = { plays: 0, created: 1, follows: 2 };
/**
 * N-R7-267 · the order Home shows your live matches in: the ones you play in or
 * created before the ones you follow, then the latest start first (undated last).
 */
export function sortMyLive<T extends { relation: MyMatchRelation; scheduled_at?: string | null; id: string }>(rows: T[]): T[] {
  const t = (r: T) => (r.scheduled_at ? new Date(r.scheduled_at).getTime() : Number.NEGATIVE_INFINITY);
  return [...rows].sort((a, b) => RANK[a.relation] - RANK[b.relation] || t(b) - t(a) || a.id.localeCompare(b.id));
}
