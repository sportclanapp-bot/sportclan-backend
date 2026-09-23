import { supabase } from './supabase';

/**
 * SC-77/78/79 — hide soft-deleted users from every OTHER-facing read.
 *
 * Account deletion (SC-70) is final: the `users` row is kept with `deleted_at`
 * set and identity scrubbed ("Deleted User"). B2-a: it is kept FOR EVER. After
 * 30 days the remaining personal fields are scrubbed too and the row becomes an
 * anonymous tombstone — it is never hard-deleted, because the cascades that
 * would have fired take whole teams, tournaments and other people's matches
 * with them.
 *
 * So these helpers hide the PERSON: they must be applied to any read that
 * surfaces a user as a user, or the deleted account leaks (rank on the
 * leaderboard, a team captain, a search hit, a directory entry).
 *
 * They must NOT be applied to that person's CONTENT. An `!inner` embed plus
 * excludeDeletedEmbed drops the PARENT row, not the name — which is how
 * "posts you made stay visible (without your name)" came to be false. Posts,
 * comments and reviews keep rendering, attributed to the scrubbed row. The full
 * list of which path chose which is pinned in deletedUserVisibility.unit.test.
 *
 * ONE shared mechanism — three shapes, so future read paths just reuse these:
 *   • direct `users` query      → excludeDeleted(query)
 *   • embedded user join        → embed with `!inner`, then excludeDeletedEmbed(query, alias)
 *   • aggregate keyed by user_id → deletedIdSet(ids) then drop those ids in JS
 *
 * Intentionally NOT applied to shared/historical records (match participants,
 * chat messages, notification actor) — those stay anonymized "Deleted User"
 * because hiding them would corrupt the OTHER party's conversation/match.
 */

/** Direct `users`-table query: exclude soft-deleted rows. */
export function excludeDeleted<Q>(q: Q): Q {
  return (q as unknown as { is: (c: string, v: null) => Q }).is('deleted_at', null);
}

/**
 * Embedded user join(s): the embed MUST be declared with `!inner`
 * (e.g. `author:users!author_id!inner(...)`) so the PARENT row drops when the
 * joined user is soft-deleted. Pass the embed alias(es) used in the select.
 */
export function excludeDeletedEmbed<Q>(q: Q, ...aliases: string[]): Q {
  let out: unknown = q;
  for (const a of aliases) {
    out = (out as { is: (c: string, v: null) => unknown }).is(`${a}.deleted_at`, null);
  }
  return out as Q;
}

/**
 * For aggregates keyed by user_id where an inner join is awkward (leaderboard
 * ranking, scorers, player-of-week): return the subset of ids that are
 * soft-deleted so the caller can drop them from the result set.
 */
export async function deletedIdSet(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase
    .from('users')
    .select('id')
    .in('id', ids)
    .not('deleted_at', 'is', null);
  return new Set((data || []).map((u: { id: string }) => u.id));
}
