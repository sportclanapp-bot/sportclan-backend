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
