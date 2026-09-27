import { supabase } from './supabase';

/**
 * SC-366: fill in team_a_name / team_b_name from the registered teams.
 *
 * `matches.team_a_name` is a denormalised column that only ever gets written for
 * FREE-TEXT opponents ("vs Rahul's XI"). A match between two REGISTERED teams
 * leaves both columns NULL, so every live card fell back to the literal strings
 * "Team A" and "Team B" — the score was sport-correct but nobody could tell who
 * was playing. The card needs real names, and the fix belongs here rather than
 * in the FE: the client shouldn't have to fetch a team per card to caption it.
 *
 * Only fills what's missing, so a free-text opponent keeps its own label.
 */
export async function attachTeamNames(matches: any[]): Promise<void> {
  if (!matches || matches.length === 0) return;
  // Migration 110: every registered side also carries its short name
  // (team_a_short_name / team_b_short_name) for scorecards and tight rows, so
  // the lookup covers all team ids, not only the ones missing a name.
  const ids = new Set<string>();
  for (const m of matches) {
    if (m.team_a_id) ids.add(m.team_a_id);
    if (m.team_b_id) ids.add(m.team_b_id);
  }
  if (ids.size === 0) return;
  // Before migration 110 `teams` had no short_name column, and selecting one
  // made PostgREST reject the whole query — so `data` came back null and no
  // name was filled. Don't swallow the error if this ever breaks again.
  const { data, error } = await supabase
    .from('teams').select('id, name, short_name').in('id', [...ids]);
  if (error) {
    console.warn('[matches] attachTeamNames: teams lookup failed', error.message);
    return;
  }
  const byId = new Map<string, { name: string | null; short_name: string | null }>();
  for (const t of data ?? []) byId.set(t.id, { name: t.name ?? null, short_name: t.short_name ?? null });
  for (const m of matches) {
    const a = m.team_a_id ? byId.get(m.team_a_id) : undefined;
    const b = m.team_b_id ? byId.get(m.team_b_id) : undefined;
    // Only fills a missing name, so a free-text opponent keeps its own label.
    if (!m.team_a_name && a) m.team_a_name = a.name ?? m.team_a_name;
    if (!m.team_b_name && b) m.team_b_name = b.name ?? m.team_b_name;
    m.team_a_short_name = a?.short_name ?? null;
    m.team_b_short_name = b?.short_name ?? null;
  }
}
