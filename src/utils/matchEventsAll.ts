/**
 * Audit #38 (11 Oct 2026): EVERY event of a match, in scoring order.
 *
 * A plain `.from('match_events').eq('match_id', …)` read is answered with at
 * most 1000 rows by PostgREST, silently. The score rebuild, the cricket innings
 * stats, the bowler's over quota, Player of the Match and the boundaries
 * tie-break all read that way, so a long match (a cricket series, a long tie)
 * stopped counting after event 1000. This reads them 1000 at a time in a stable
 * order (created_at, then id: an offline batch shares one timestamp).
 */
import { supabase } from './supabase';
import { selectAll } from './selectAll';

export function matchEventsAll<T = any>(
  matchId: string,
  columns: string,
  narrow?: (q: any) => any,
): Promise<T[]> {
  return selectAll<T>((from, to) => {
    let q: any = supabase.from('match_events').select(columns).eq('match_id', matchId);
    if (narrow) q = narrow(q);
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to);
  });
}
