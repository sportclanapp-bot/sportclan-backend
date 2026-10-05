/**
 * A real knockout bracket match: a knockout tournament, or the knockout stage of
 * groups → knockout (round > 0, no group label). League / round-robin fixtures
 * carry round 1 too but may tie. Keyed on the tournament FORMAT (SC-257/258).
 * Moved here from matches.controller (cricket gap 9) so scoring can ask it too.
 */
import { supabase } from './supabase';

export async function isKnockoutBracketMatch(match: {
  tournament_id: string | null; round: number | null; group_label: string | null;
}): Promise<boolean> {
  if (!match.tournament_id || match.round == null || match.round <= 0 || match.group_label) return false;
  const { data: t } = await supabase
    .from('tournaments').select('format').eq('id', match.tournament_id).maybeSingle();
  const fmt = (t as any)?.format;
  return fmt === 'knockout' || fmt === 'groups_knockout';
}
