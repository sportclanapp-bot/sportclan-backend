/**
 * Phase 3 · decision 4: umpires get an officiated count.
 *
 * Completed, not voided, with this person as the umpire — the same rule the
 * match-history "officiated" count uses, so the profile number and the list
 * behind it cannot disagree.
 */
import { supabase } from './supabase';

export async function officiatedCount(userId: string): Promise<number> {
  try {
    const { count } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('umpire_id', userId)
      .eq('status', 'completed')
      .is('voided_at', null);
    return count ?? 0;
  } catch {
    return 0;
  }
}
