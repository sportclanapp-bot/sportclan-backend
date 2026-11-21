/**
 * Q51 (Dipak, 21 Nov 2026, A): a team's page and a player's profile carry an "Honours" line —
 * "🏆 Champion · <tournament>", "🥈 Runner-up · <tournament>", newest first, tapping opens it.
 *
 * Champion: a completed tournament's champion_team_id (crowned by championOf: the final's winner,
 * the table's leader, the ladder's top rung, the top box). Runner-up: the team that lost the final
 * of a completed knockout-style tournament (the bracket match with no next match, no group, not the
 * third-place match, won by the champion). A league / round robin / ladder / box / plain Swiss is won
 * on the table, so it has a champion and no runner-up here (the Overview names none either).
 *
 * A player's honours: the teams they played for in that tournament (its squad, when the team had
 * one), else the team's members (a singles entry is the player's own one-person team).
 */
import { supabase } from './supabase';
import { allRows } from './selectAll';

export type Honour = {
  tournament_id: string;
  tournament_name: string;
  place: 'champion' | 'runner_up';
  team_id: string;
  team_name: string | null;
  /** when it was won: the tournament's end date, else its start date, else when it was last changed */
  date: string | null;
};

const TABLE_FORMATS = new Set(['league', 'round_robin', 'ladder', 'box']);
const CHUNK = 200;
const chunks = <T>(xs: T[]): T[][] => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

export type TRow = { id: string; name: string | null; event_label?: string | null; format: string | null; settings?: unknown; champion_team_id: string | null; end_date: string | null; start_date: string | null; updated_at: string | null };
const T_COLS = 'id, name, event_label, format, settings, champion_team_id, end_date, start_date, updated_at';

function nameOf(t: TRow): string {
  return t.event_label ? `${t.name ?? 'Tournament'} · ${t.event_label}` : t.name ?? 'Tournament';
}
function dateOf(t: TRow): string | null {
  return t.end_date ?? t.start_date ?? t.updated_at ?? null;
}

/** Every honour of these teams, newest first. */
export async function honoursOfTeams(teamIds: string[]): Promise<Honour[]> {
  const ids = Array.from(new Set(teamIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const out: Honour[] = [];
  const teamNames = new Map<string, string | null>();
  for (const part of chunks(ids)) {
    const champs = await allRows<TRow>(() => supabase.from('tournaments').select(T_COLS).eq('status', 'completed').in('champion_team_id', part));
    for (const t of champs) out.push({ tournament_id: t.id, tournament_name: nameOf(t), place: 'champion', team_id: t.champion_team_id as string, team_name: null, date: dateOf(t) });
    // the finals these teams lost: no next match, no group, not the third-place match, decided
    const lostA = await allRows<{ tournament_id: string; team_a_id: string; winner_team_id: string; bracket: string | null; third_place: boolean | null }>(() => supabase.from('matches')
      .select('id, tournament_id, team_a_id, winner_team_id, bracket, third_place').in('team_a_id', part)
      .not('tournament_id', 'is', null).is('next_match_id', null).is('group_label', null).is('voided_at', null)
      .not('winner_team_id', 'is', null).in('status', ['completed', 'abandoned']));
    const lostB = await allRows<{ tournament_id: string; team_b_id: string; winner_team_id: string; bracket: string | null; third_place: boolean | null }>(() => supabase.from('matches')
      .select('id, tournament_id, team_b_id, winner_team_id, bracket, third_place').in('team_b_id', part)
      .not('tournament_id', 'is', null).is('next_match_id', null).is('group_label', null).is('voided_at', null)
      .not('winner_team_id', 'is', null).in('status', ['completed', 'abandoned']));
    const finals = [
      ...lostA.map((m) => ({ ...m, loser: m.team_a_id })),
      ...lostB.map((m) => ({ ...m, loser: m.team_b_id })),
    ];
    const tids = Array.from(new Set(finals.map((m) => m.tournament_id)));
    for (const tpart of chunks(tids)) {
      const ts = await allRows<TRow>(() => supabase.from('tournaments').select(T_COLS).eq('status', 'completed').in('id', tpart));
      for (const h of runnerUpsFrom(finals, ts)) if (!out.some((x) => x.tournament_id === h.tournament_id && x.team_id === h.team_id)) out.push(h);
    }
  }
  const need = Array.from(new Set(out.map((h) => h.team_id)));
  for (const part of chunks(need)) {
    const rows = await allRows<{ id: string; name: string | null }>(() => supabase.from('teams').select('id, name').in('id', part));
    for (const r of rows) teamNames.set(r.id, r.name);
  }
  for (const h of out) h.team_name = teamNames.get(h.team_id) ?? null;
  return sortHonours(out);
}

type Final = { tournament_id: string; winner_team_id: string; loser: string; bracket: string | null; third_place: boolean | null };
/** The runners-up among these lost matches (no next match, no group): the finals of completed knockout-style tournaments, won by the champion. */
export function runnerUpsFrom(finals: Final[], tournaments: TRow[]): Honour[] {
  const byId = new Map(tournaments.map((t) => [t.id, t]));
  const out: Honour[] = [];
  for (const m of finals) {
    if (m.third_place === true || m.bracket === 'back' || m.winner_team_id === m.loser) continue;
    const t = byId.get(m.tournament_id);
    if (!t || !t.champion_team_id || m.winner_team_id !== t.champion_team_id) continue; // the champion won it: it was the final
    if (TABLE_FORMATS.has(t.format ?? '')) continue; // won on the table
    const swissKo = t.format === 'swiss' && !!(t.settings as { swiss?: { koDrawn?: boolean } } | null)?.swiss?.koDrawn;
    if (t.format === 'swiss' && (!swissKo || m.bracket !== 'ko')) continue; // a Swiss round isn't a final
    if (out.some((h) => h.tournament_id === t.id && h.team_id === m.loser)) continue;
    out.push({ tournament_id: t.id, tournament_name: nameOf(t), place: 'runner_up', team_id: m.loser, team_name: null, date: dateOf(t) });
  }
  return out;
}

/** Newest first; champion before runner-up on the same date; then by name, so the order is stable. */
export function sortHonours(hs: Honour[]): Honour[] {
  return [...hs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')
    || (a.place === b.place ? 0 : a.place === 'champion' ? -1 : 1)
    || a.tournament_name.localeCompare(b.tournament_name));
}

/** A player's honours: their squad's in that tournament, else (no squad named) as one of the team's members. */
export async function honoursOfUser(userId: string): Promise<Honour[]> {
  const squads = await allRows<{ tournament_id: string; team_id: string }>(() => supabase.from('tournament_squads')
    .select('id, tournament_id, team_id').eq('user_id', userId).is('removed_at', null));
  const members = await allRows<{ team_id: string }>(() => supabase.from('team_members').select('id, team_id').eq('user_id', userId));
  const memberOf = new Set(members.map((m) => m.team_id));
  const inSquad = new Set(squads.map((s) => `${s.tournament_id}|${s.team_id}`));
  const all = await honoursOfTeams([...squads.map((s) => s.team_id), ...memberOf]);
  if (all.length === 0) return [];
  // which of those (tournament, team) pairs named a squad at all
  const named = new Set<string>();
  for (const part of chunks(Array.from(new Set(all.map((h) => h.tournament_id))))) {
    const rows = await allRows<{ tournament_id: string; team_id: string }>(() => supabase.from('tournament_squads')
      .select('id, tournament_id, team_id').in('tournament_id', part).is('removed_at', null));
    for (const r of rows) named.add(`${r.tournament_id}|${r.team_id}`);
  }
  return all.filter((h) => {
    const key = `${h.tournament_id}|${h.team_id}`;
    return inSquad.has(key) || (!named.has(key) && memberOf.has(h.team_id));
  });
}
