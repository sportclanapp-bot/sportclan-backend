import { supabase } from './supabase';

/**
 * Audit #1–#3 (11 Oct 2026): a person's sports in the app's display order
 * (sports.display_order — Cricket first). user_sports was read with no order,
 * so "the first of your sports" was whatever order the database returned.
 */
export function inDisplayOrder<T extends { sport_id: string; order?: number | null }>(rows: T[]): string[] {
  return rows
    .map((r, i) => ({ id: r.sport_id, o: r.order != null && Number.isFinite(Number(r.order)) ? Number(r.order) : Number.MAX_SAFE_INTEGER, i }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map((r) => r.id);
}

const flat = (rows: unknown): Array<{ sport_id: string; order: number | null }> =>
  ((rows ?? []) as Array<{ sport_id: string; sport?: { display_order?: number | null } | Array<{ display_order?: number | null }> | null }>)
    .map((r) => ({ sport_id: r.sport_id, order: (Array.isArray(r.sport) ? r.sport[0]?.display_order : r.sport?.display_order) ?? null }));

/** The sports a person said they play, in display order. */
export async function orderedSportIds(userId: string): Promise<string[]> {
  const { data } = await supabase.from('user_sports').select('sport_id, sport:sports!sport_id(display_order)').eq('user_id', userId);
  return inDisplayOrder(flat(data));
}

/** Audit #3: the sports a person plays — their chosen ones, else the ones they've played matches in — in display order. */
export async function profileSportIds(userId: string): Promise<string[]> {
  const chosen = await orderedSportIds(userId);
  if (chosen.length) return chosen;
  const { data } = await supabase.from('user_sport_profiles').select('sport_id, matches_played, sport:sports!sport_id(display_order)').eq('user_id', userId).gt('matches_played', 0);
  return inDisplayOrder(flat(data));
}
