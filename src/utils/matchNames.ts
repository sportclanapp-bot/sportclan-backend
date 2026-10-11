import { supabase } from './supabase';

/**
 * Audit #87/#89 (11 Oct 2026): "Lions vs Tigers" for a push or a reminder — the
 * typed names, else the registered teams' names (a team match stores no names:
 * they are attached when read, so a reminder read "null vs null"). Null when
 * a side has no name at all.
 */
export async function matchNamesForNotice(m: { team_a_id?: string | null; team_b_id?: string | null; team_a_name?: string | null; team_b_name?: string | null }): Promise<string | null> {
  let a = m.team_a_name?.trim() || null; let b = m.team_b_name?.trim() || null;
  const ids = [!a ? m.team_a_id : null, !b ? m.team_b_id : null].filter((x): x is string => !!x);
  if (ids.length) {
    const { data } = await supabase.from('teams').select('id, name').in('id', ids);
    const nm = new Map(((data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]));
    if (!a && m.team_a_id) a = nm.get(m.team_a_id) ?? null;
    if (!b && m.team_b_id) b = nm.get(m.team_b_id) ?? null;
  }
  return a && b ? `${a} vs ${b}` : null;
}
