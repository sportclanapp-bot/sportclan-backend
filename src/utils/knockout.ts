/**
 * A real knockout bracket match: a knockout tournament, or the knockout stage of
 * groups → knockout (round > 0, no group label). League / round-robin fixtures
 * carry round 1 too but may tie. Keyed on the tournament FORMAT (SC-257/258).
 * Moved here from matches.controller (cricket gap 9) so scoring can ask it too.
 */
import { supabase } from './supabase';

export async function isKnockoutBracketMatch(match: {
  tournament_id: string | null; round: number | null; group_label: string | null;
  id?: string | null; bracket?: string | null;
}): Promise<boolean> {
  if (!match.tournament_id || match.round == null || match.round <= 0 || match.group_label) return false;
  const { data: t } = await supabase
    .from('tournaments').select('format').eq('id', match.tournament_id).maybeSingle();
  const fmt = (t as any)?.format;
  if (fmt === 'knockout' || fmt === 'groups_knockout') return true;
  // Audit #55: the knockout after a Swiss (bracket 'ko', CR9) is a knockout
  // too — a level or abandoned match there needs a winner, and a shoot-out,
  // super over or chess tie-break may settle it.
  if (fmt === 'swiss') {
    let bracket = match.bracket;
    if (bracket === undefined && match.id) {
      const { data: row } = await supabase.from('matches').select('bracket').eq('id', match.id).maybeSingle();
      bracket = (row as { bracket?: string | null } | null)?.bracket ?? null;
    }
    return bracket === 'ko';
  }
  return false;
}
