/**
 * Audit #23–#25 (11 Oct 2026, Dipak's decision 4): user data is never hard
 * deleted. Migration 147 archives every deleted row (deleted_records, with
 * deleted_at / deleted_by / deleted_reason) before it leaves its table, so no
 * read needs a filter. The deletes the audit named go through here to record
 * WHO and WHY as well.
 *
 *   await deleteMatching('team_members', (q) => q.eq('team_id', t).eq('user_id', u), actorId, 'removed by a captain');
 */
import { supabase } from './supabase';

export async function deleteWithReason(table: string, ids: string[], by: string | null, reason: string): Promise<{ error: string | null; count: number }> {
  if (ids.length === 0) return { error: null, count: 0 };
  let data: unknown = null; let error: { message: string; code?: string } | null = null;
  try {
    ({ data, error } = await supabase.rpc('delete_with_reason', { p_table: table, p_ids: ids, p_by: by, p_reason: reason }) as never);
  } catch (e) {
    error = { message: String((e as Error)?.message ?? e), code: 'PGRST202' }; // no rpc at all: treat as "not there yet"
  }
  if (!error) return { error: null, count: Number(data ?? 0) };
  // Before migration 147 the function isn't there: the plain delete (no archive yet).
  const missing = (error as { code?: string }).code === 'PGRST202' || (error as { code?: string }).code === '42883';
  if (!missing) return { error: error.message, count: 0 };
  const plain = await supabase.from(table).delete().in('id', ids);
  return { error: plain.error ? plain.error.message : null, count: ids.length };
}

/** Delete the rows `narrow` selects from `table`, recording who and why. */
export async function deleteMatching(
  table: string,
  narrow: (q: any) => any,
  by: string | null,
  reason: string,
): Promise<{ error: string | null; count: number; ids: string[] }> {
  const { data, error } = await narrow(supabase.from(table).select('id'));
  if (error) return { error: error.message, count: 0, ids: [] };
  const ids = (Array.isArray(data) ? (data as Array<{ id: string }>) : []).map((r) => r.id);
  const out = await deleteWithReason(table, ids, by, reason);
  return { ...out, ids };
}
