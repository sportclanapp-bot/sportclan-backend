/**
 * Badminton gap 8 (Oct 2026) · awards per event: the winner, the runner-up and
 * the two semi-finalists (badminton gives two bronzes) — or third and fourth
 * when a third-place match was played, or the top four of a finished table —
 * each with its players, for the awards poster and a certificate per player.
 * Sport-neutral. A tournament made of events answers for every event.
 */
import { allRows } from '../utils/selectAll';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { rankTeams, pointsFor } from '../utils/standings';
import { tableInputs } from '../utils/tournamentSettings';
import { getSport } from '../utils/sportCache';
import { loadLeaders } from './features.controller';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { fairPlayPoints, type CardEvent } from '../utils/fairPlay';
import { settingsOf, settingsRefusal, storedSettings, type PickedAward } from '../utils/tournamentSettings';
import { selectAllIn } from '../utils/selectAll';
import { rankExtrasFor } from '../utils/rankExtras';

export type Placing = { place: 1 | 2 | 3 | 4; title: string; team_id: string; name: string; players: Array<{ id: string; name: string }> };
type M = { id: string; team_a_id: string | null; team_b_id: string | null; team_a_name: string | null; team_b_name: string | null; winner_team_id: string | null; status: string; round: number | null; group_label: string | null; third_place?: boolean | null; voided_at: string | null; score_summary?: unknown; overs?: number | null };

const TITLES = { 1: 'Winner', 2: 'Runner-up', 3: 'Third', 4: 'Fourth' } as const;

/** Pure: the knockout's placings from its matches (final, third-place match or semi-finals). */
export function knockoutPlacings(matches: M[]): Array<{ place: 1 | 2 | 3 | 4; title: string; team_id: string; name: string }> {
  const ko = matches.filter((m) => !m.voided_at && !m.group_label && (m.round ?? 0) >= 1);
  const main = ko.filter((m) => !m.third_place);
  if (main.length === 0) return [];
  const lastRound = Math.max(...main.map((m) => m.round ?? 0));
  const final = main.find((m) => m.round === lastRound);
  if (!final || final.status !== 'completed' || !final.winner_team_id) return [];
  const nameOf = (m: M, id: string) => (id === m.team_a_id ? m.team_a_name : m.team_b_name) ?? 'TBD';
  const loserOf = (m: M) => (m.winner_team_id === m.team_a_id ? m.team_b_id : m.team_a_id);
  const out: Array<{ place: 1 | 2 | 3 | 4; title: string; team_id: string; name: string }> = [];
  out.push({ place: 1, title: TITLES[1], team_id: final.winner_team_id, name: nameOf(final, final.winner_team_id) });
  const ru = loserOf(final);
  if (ru) out.push({ place: 2, title: TITLES[2], team_id: ru, name: nameOf(final, ru) });
  const third = ko.find((m) => m.third_place);
  if (third && third.status === 'completed' && third.winner_team_id) {
    out.push({ place: 3, title: TITLES[3], team_id: third.winner_team_id, name: nameOf(third, third.winner_team_id) });
    const fourth = loserOf(third);
    if (fourth) out.push({ place: 4, title: TITLES[4], team_id: fourth, name: nameOf(third, fourth) });
  } else if (!third) {
    // Two bronzes: both semi-final losers.
    for (const sf of main.filter((m) => m.round === lastRound - 1 && m.status === 'completed' && m.winner_team_id)) {
      const l = loserOf(sf);
      if (l) out.push({ place: 3, title: 'Semi-finalist', team_id: l, name: nameOf(sf, l) });
    }
  }
  return out;
}

async function placingsFor(t: { id: string; format: string; status: string; sport_id: string | null; tiebreaker_rules?: unknown; settings?: unknown }): Promise<Placing[]> {
  const ms = await allRows(() => supabase.from('matches')
    .select('id, team_a_id, team_b_id, team_a_name, team_b_name, winner_team_id, status, round, group_label, third_place, voided_at, score_summary, overs')
    .eq('tournament_id', t.id));
  const matches = (ms ?? []) as M[];
  let base: Array<{ place: 1 | 2 | 3 | 4; title: string; team_id: string; name: string }> = [];
  if (t.format === 'knockout' || t.format === 'groups_knockout') base = knockoutPlacings(matches);
  else if (t.status === 'completed') {
    const ents = await allRows(() => supabase.from('tournament_entries').select('team_id, status, team:teams!team_id(id, name)').eq('tournament_id', t.id).in('status', ['approved', 'withdrawn']));
    const rows = (ents ?? []) as Array<{ team_id: string; status: string; team: { name?: string } | Array<{ name?: string }> | null }>;
    const nameOf = new Map(rows.map((r) => [r.team_id, (Array.isArray(r.team) ? r.team[0]?.name : r.team?.name) ?? 'Team']));
    const tin = tableInputs(t.settings, rows.filter((r) => r.status === 'approved').map((r) => r.team_id),
      matches.filter((m) => !m.voided_at && (m.status === 'completed' || m.status === 'abandoned')), rows.filter((r) => r.status === 'withdrawn').map((r) => r.team_id));
    const slug = (await getSport(String(t.sport_id)))?.slug ?? null;
    const order = rankTeams(tin.teamIds, tin.matches as never[], ((t.tiebreaker_rules ?? []) as never[]), pointsFor(slug, t.settings), (await rankExtrasFor(t, tin.matches as Array<{ id: string }>))('')); // Stage 8 · F8
    base = order.slice(0, 4).map((id, i) => ({ place: (i + 1) as 1 | 2 | 3 | 4, title: TITLES[(i + 1) as 1 | 2 | 3 | 4], team_id: id, name: nameOf.get(id) ?? 'Team' }));
  }
  if (base.length === 0) return [];
  const { data: mem } = await supabase.from('team_members').select('team_id, user_id, role').in('team_id', base.map((b) => b.team_id));
  const memRows = ((mem ?? []) as Array<{ team_id: string; user_id: string; role: string }>).sort((a, b) => (a.role === 'captain' ? -1 : 0) - (b.role === 'captain' ? -1 : 0));
  const ids = [...new Set(memRows.map((r) => r.user_id))];
  const { data: users } = ids.length ? await supabase.from('users').select('id, name, username').in('id', ids).is('deleted_at', null) : { data: [] };
  const userName = new Map(((users ?? []) as Array<{ id: string; name: string | null; username: string | null }>).map((u) => [u.id, u.name || u.username || 'Player']));
  return base.map((b) => ({
    ...b,
    players: memRows.filter((r) => r.team_id === b.team_id && userName.has(r.user_id)).map((r) => ({ id: r.user_id, name: userName.get(r.user_id)! })),
  }));
}

// GET /tournaments/:id/placings — this tournament's (or each of its events') placings.
export async function getPlacings(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const cols = 'id, name, event_label, event_order, format, status, sport_id, tiebreaker_rules, settings, is_parent, start_date, end_date, venue';
    const { data: t } = await supabase.from('tournaments').select(cols).eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const list = (t as { is_parent?: boolean }).is_parent
      ? (((await supabase.from('tournaments').select(cols).eq('parent_id', id).order('event_order', { ascending: true })).data ?? []) as typeof t[])
      : [t];
    const events = [];
    for (const e of list as Array<Record<string, any>>) {
      events.push({ tournament_id: e.id, label: e.event_label ?? null, name: e.name, status: e.status, placings: await placingsFor(e as never) });
    }
    return res.json({ name: (t as { name: string }).name, venue: (t as { venue?: string }).venue ?? null, start_date: (t as { start_date?: string }).start_date ?? null, end_date: (t as { end_date?: string }).end_date ?? null, events });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Stage 8 · F7 (Oct 2026) · awards: computed per sport, and the organiser's ─
//
// GET /tournaments/:id/awards → { computed: [...], picked: [...], can_edit }
//   computed: from the leaderboards (F6) — football's Golden Boot and most
//   assists, hockey's / basketball's top scorer, cricket's player of the
//   tournament, most runs and most wickets — and, in the card sports, the
//   fair-play team (best FIFA fair-play points; only when someone was booked).
//   Joint winners share an award.
// PUT /tournaments/:id/awards { awards: [{ title, user_id? | name?, team_id? }] }
//   The organiser's awards (best player, best keeper, emerging player…) — any
//   number, any sport, any time. Stored on settings.awards.

export type ComputedAward = { key: string; title: string; winners: Array<{ user_id: string | null; name: string; team_name: string | null }>; value: string };

const AWARD_BOARDS: Record<string, Array<[string, string, string, string]>> = {
  football: [['golden_boot', 'Golden Boot', 'goals', 'goal|goals'], ['most_assists', 'Most assists', 'assists', 'assist|assists']],
  hockey: [['top_scorer', 'Top scorer', 'goals', 'goal|goals']],
  basketball: [['top_scorer', 'Top scorer', 'points', 'point|points']],
  cricket: [['player_of_tournament', 'Player of the tournament', 'player_of_tournament', 'pt|pts'], ['most_runs', 'Most runs', 'runs', 'run|runs'], ['most_wickets', 'Most wickets', 'wickets', 'wicket|wickets']],
};
const CARD_SPORTS = new Set(['football', 'hockey']);

/** Pure: the computed awards from the boards and (card sports) each team's fair-play points. */
export function computedAwards(
  sport: string, boards: Array<{ stat: string; rows: Array<{ user_id: string | null; name: string; team_name: string | null; value: number }> }>,
  fairPlay: Map<string, number> | null, playedTeams: string[], teamNames: Map<string, string>,
): ComputedAward[] {
  const out: ComputedAward[] = [];
  for (const [key, title, stat, unit] of AWARD_BOARDS[sport] ?? []) {
    const rows = boards.find((b) => b.stat === stat)?.rows ?? [];
    const top = rows[0]?.value;
    if (!top || top <= 0) continue;
    const [one, many] = unit.split('|') as [string, string];
    out.push({ key, title, winners: rows.filter((r) => r.value === top).map((r) => ({ user_id: r.user_id, name: r.name, team_name: r.team_name })), value: `${top} ${top === 1 ? one : many}` });
  }
  if (fairPlay && CARD_SPORTS.has(sport) && fairPlay.size > 0 && playedTeams.length > 1) {
    const pts = (t: string) => fairPlay.get(t) ?? 0;
    const best = Math.max(...playedTeams.map(pts));
    const winners = playedTeams.filter((t) => pts(t) === best);
    if (winners.length < playedTeams.length) {
      out.push({ key: 'fair_play', title: 'Fair play', winners: winners.map((t) => ({ user_id: null, name: teamNames.get(t) ?? 'Team', team_name: null })), value: best === 0 ? 'no cards' : `${best} fair-play points` });
    }
  }
  return out;
}

async function pickedView(list: PickedAward[]) {
  const users = [...new Set(list.map((a) => a.user_id).filter((x): x is string => !!x && isUuid(x)))];
  const teams = [...new Set(list.map((a) => a.team_id).filter((x): x is string => !!x && isUuid(x)))];
  const { data: us } = users.length ? await supabase.from('users').select('id, name, deleted_at').in('id', users) : { data: [] };
  const { data: ts } = teams.length ? await supabase.from('teams').select('id, name').in('id', teams) : { data: [] };
  const uName = new Map(((us ?? []) as Array<{ id: string; name: string | null; deleted_at: string | null }>).filter((u) => !u.deleted_at).map((u) => [u.id, u.name]));
  const tName = new Map(((ts ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]));
  return list.map((a) => ({
    title: a.title,
    user_id: a.user_id && uName.has(a.user_id) ? a.user_id : null,
    name: (a.user_id ? uName.get(a.user_id) : null) ?? a.name ?? null,
    team_id: a.team_id ?? null,
    team_name: a.team_id ? tName.get(a.team_id) ?? null : null,
  }));
}

export async function getAwards(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const { data: t } = await supabase.from('tournaments').select('id, settings, is_parent').eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const picked = await pickedView(settingsOf(t as { settings?: unknown }).awards ?? []);
    const canEdit = await isTournamentOrganiser(id, userId);
    if ((t as { is_parent?: boolean }).is_parent) return res.json({ computed: [], picked, can_edit: canEdit });
    const L = await loadLeaders(id);
    if (!L) return res.status(404).json({ error: 'Tournament not found' });
    let fair: Map<string, number> | null = null;
    if (CARD_SPORTS.has(L.slug) && L.played.length) {
      const evs = await selectAllIn(L.played.map((m) => m.id), (c, f, to) => supabase.from('match_events').select('id, match_id, payload').eq('event_type', 'card').in('match_id', c).order('id').range(f, to));
      fair = fairPlayPoints((evs ?? []) as CardEvent[], new Map(L.played.map((m) => [m.id, { A: m.team_a_id, B: m.team_b_id }])));
    }
    const playedTeams = [...new Set(L.played.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((x): x is string => !!x))];
    return res.json({ computed: computedAwards(L.slug, L.boards, fair, playedTeams, L.teamMap), picked, can_edit: canEdit });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function setAwards(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const { data: t } = await supabase.from('tournaments').select('id, format, settings, sport_id').eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(id, userId))) return res.status(403).json({ error: 'Only the organiser can give awards.' });
    const awards = (req.body ?? {}).awards;
    const sport = (await getSport(String((t as { sport_id?: string }).sport_id)))?.slug ?? null;
    const bad = settingsRefusal(sport, (t as { format?: string }).format ?? null, { awards: awards ?? [] });
    if (bad) return res.status(400).json(bad);
    const next = storedSettings({ awards: awards ?? [] }, settingsOf(t as { settings?: unknown }));
    const { error } = await supabase.from('tournaments').update({ settings: next }).eq('id', id);
    if (error) return res.status(500).json({ error: 'Couldn’t save the awards.' });
    return res.json({ picked: await pickedView(next.awards ?? []) });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
