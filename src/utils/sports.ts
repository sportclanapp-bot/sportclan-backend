import { supabase } from './supabase';

/**
 * Whether a sport is soft-deactivated (out of scope, e.g. kabaddi/athletics).
 *
 * Undefined-safe by design: it reads the whole row with `select('*')`, so if
 * the `is_active` column doesn't exist yet (i.e. this code is deployed before
 * the deactivation SQL runs), `data.is_active` is simply `undefined` and this
 * returns `false` (treat as active). It only reports inactive when the column
 * exists AND is explicitly `false`. An unknown/absent sport row also returns
 * `false` so we never change behaviour for pre-existing odd sport_ids.
 */
export async function isSportInactive(sportId?: string | null): Promise<boolean> {
  if (!sportId) return false;
  const { data } = await supabase
    .from('sports')
    .select('*')
    .eq('id', sportId)
    .maybeSingle();
  return data?.is_active === false;
}

/**
 * The ids of all ACTIVE sports — for filtering user-facing lists (match lists,
 * etc.) so existing rows in a deactivated sport (kabaddi/athletics) never surface.
 * Undefined-safe pre-migration: `is_active` absent → every sport is treated active,
 * so behaviour is unchanged until migration 070 runs. Returns null if the read
 * fails, so callers can skip the filter rather than blank the list.
 */
export async function activeSportIds(): Promise<string[] | null> {
  const { data, error } = await supabase.from('sports').select('id, is_active');
  if (error || !data) return null;
  return data.filter((s: { is_active?: boolean }) => s.is_active !== false).map((s: { id: string }) => s.id);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a sport_id at create time (SC-36). Returns a client-safe error
 * message string, or null when the sport is valid + active. Replaces the
 * bare isSportInactive() gate: a malformed or unknown sport_id previously
 * slipped through and 500'd on the uuid cast / FK violation at insert.
 */
export async function validateSportForCreate(sportId?: string | null): Promise<string | null> {
  if (!sportId || !UUID_RE.test(String(sportId))) return 'A valid sport is required';
  const { data } = await supabase
    .from('sports')
    .select('*')
    .eq('id', sportId)
    .maybeSingle();
  if (!data) return 'Unknown sport';
  if (data.is_active === false) return 'This sport is not available';
  return null;
}

