import { supabase } from './supabase';

/**
 * SC-81/82 — hide BLOCKED users (either direction) from a viewer's read paths.
 *
 * Blocks are bidirectional and viewer-relative: if A blocks B (or B blocks A),
 * then B must not surface in A's feed / search / rival / discovery, and vice
 * versa. This is a DIFFERENT filter class from `activeUser.ts` (deleted_at):
 *   • deleted_at   → absolute/global (a deleted user is hidden from EVERYONE),
 *                    applied as an inner-join / query predicate.
 *   • user_blocks  → relative (depends on WHO is asking), so it's always a
 *                    per-request id-set exclusion keyed on the viewer.
 * Kept as its own util (parallel in style to activeUser.ts) so each filter
 * class stays single-responsibility.
 *
 * Mirrors the block-set fetch that `discoverPlayers` already uses. Does NOT
 * include the viewer themselves (callers must not hide their own content).
 */
export async function blockedUserIds(viewerId?: string): Promise<Set<string>> {
  if (!viewerId) return new Set();
  const [outRes, inRes] = await Promise.all([
    supabase.from('user_blocks').select('blocked_id').eq('blocker_id', viewerId),
    supabase.from('user_blocks').select('blocker_id').eq('blocked_id', viewerId),
  ]);
  const s = new Set<string>();
  for (const b of outRes.data || []) s.add((b as { blocked_id: string }).blocked_id);
  for (const b of inRes.data || []) s.add((b as { blocker_id: string }).blocker_id);
  return s;
}

/**
 * Apply a `NOT IN (blocked ids)` filter on `column` of a Supabase query.
 * No-op when the set is empty (the common case), so normal reads are untouched.
 */
export function excludeIds<Q>(q: Q, column: string, ids: Set<string>): Q {
  if (ids.size === 0) return q;
  return (q as unknown as { not: (c: string, op: string, v: string) => Q })
    .not(column, 'in', `(${[...ids].join(',')})`);
}
