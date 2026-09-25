/**
 * The sports table barely changes, but completion and every scoring event looked
 * a sport up by id — one ~300 ms database round-trip each time from Render.
 * Cached per process for ten minutes; a miss (or an error) just reads it again.
 */
import { supabase } from './supabase';

export interface SportRow {
  id: string;
  slug: string | null;
  name: string | null;
  allows_draw: boolean | null;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { row: SportRow; at: number }>();

export async function getSport(sportId: string | null | undefined): Promise<SportRow | null> {
  if (!sportId) return null;
  const hit = cache.get(sportId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
  const { data } = await supabase.from('sports').select('id, slug, name, allows_draw').eq('id', sportId).maybeSingle();
  if (!data) return null;
  const row = data as SportRow;
  cache.set(sportId, { row, at: Date.now() });
  return row;
}

/** 'table-tennis' → 'tabletennis': the single-token form every rule table uses. */
export const normSportSlug = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[-_\s]/g, '');

export function __clearSportCacheForTests() {
  cache.clear();
}
