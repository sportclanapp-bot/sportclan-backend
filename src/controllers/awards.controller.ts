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
    const order = rankTeams(tin.teamIds, tin.matches as never[], ((t.tiebreaker_rules ?? []) as never[]), pointsFor(slug, t.settings));
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
