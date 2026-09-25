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
  /** Absent before migration 070 — treated as active. */
  is_active?: boolean | null;
}

const TTL_MS = 10 * 60 * 1000;
let table: { rows: SportRow[]; byId: Map<string, SportRow>; at: number } | null = null;
let loading: Promise<SportRow[] | null> | null = null;

/**
 * The whole sports table (a dozen rows), cached. `null` when it cannot be read
 * and nothing is cached — callers keep their own fail-open behaviour.
 * `select('*')` so it works before and after the is_active migration.
 */
export async function allSports(): Promise<SportRow[] | null> {
  if (table && Date.now() - table.at < TTL_MS) return table.rows;
  if (!loading) {
    loading = Promise.resolve(supabase.from('sports').select('*'))
      .then(({ data, error }) => {
        if (error || !data) return table?.rows ?? null; // keep a stale copy over nothing
        const rows = data as SportRow[];
        table = { rows, byId: new Map(rows.map((r) => [r.id, r])), at: Date.now() };
        return rows;
      })
      .catch(() => table?.rows ?? null)
      .finally(() => { loading = null; });
  }
  return loading;
}

export async function getSport(sportId: string | null | undefined): Promise<SportRow | null> {
  if (!sportId) return null;
  await allSports();
  const hit = table?.byId.get(sportId);
  if (hit) return hit;
  // Not in the table we hold (a sport added in the last ten minutes): read it.
  const { data } = await supabase.from('sports').select('*').eq('id', sportId).maybeSingle();
  return (data as SportRow | null) ?? null;
}

/** 'table-tennis' → 'tabletennis': the single-token form every rule table uses. */
export const normSportSlug = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[-_\s]/g, '');

export function __clearSportCacheForTests() {
  table = null;
  loading = null;
}
