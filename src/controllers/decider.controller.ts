/**
 * Q31 (Dipak chose B, 21 Nov 2026) · teams level on every tie-break: the organiser draws lots
 * (lots.controller) OR has two level teams play a decider match. POST /tournaments/:id/decider
 * { group: 'A' | null, team_ids: [a, b] } makes the match — scored like any match of the sport, with
 * the tournament's group rules — outside the tables and brackets (tournament_id null, so no table,
 * bracket, Leaders or Honours count reads it). It is kept on settings.deciders; when it finishes
 * with a winner, that team goes first in the group's draw-of-lots order (settings.lots), so the
 * champion and the knockout seeding follow, as with lots drawn by hand. A decider that ends level
 * writes nothing: play another, or draw lots. Three or more teams level: lots only (the app says so).
 */
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { settingsOf, storedSettings, type Decider } from '../utils/tournamentSettings';
import { getSport, normSportSlug } from '../utils/sportCache';
import { legacyFromRules } from '../utils/matchRules';
import { fixtureRulesFor } from './tournaments.controller';
import { afterLots } from './lots.controller';

type T = { id: string; sport_id?: string; settings?: unknown; format?: string; status?: string; champion_team_id?: string | null; venue?: string | null; city_id?: string | null; match_rules?: unknown; entry_kind?: string | null };
type M = { id: string; status: string; winner_team_id: string | null; voided_at: string | null; team_a_id: string | null; team_b_id: string | null };

/** Each group's latest decider, as the table shows it. */
export type DeciderView = { group: string | null; match_id: string; team_ids: string[]; status: string; winner_team_id: string | null; closed: boolean };

const TABLE_FORMATS = new Set(['league', 'round_robin', 'groups_knockout', 'swiss', 'box']);

export async function createDecider(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const { data } = await supabase.from('tournaments').select('id, sport_id, settings, format, status, champion_team_id, venue, city_id, match_rules, entry_kind').eq('id', id).maybeSingle();
    const t = data as T | null;
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(id, userId))) return res.status(403).json({ error: 'Only the organiser can set a decider match.' });
    if (!TABLE_FORMATS.has(String(t.format))) return res.status(409).json({ error: 'A decider match is for teams level in a table.', code: 'NO_TABLE' });
    const body = (req.body ?? {}) as { group?: unknown; team_ids?: unknown };
    const group = typeof body.group === 'string' && body.group.trim() ? body.group.trim() : '';
    const ids = Array.isArray(body.team_ids) ? body.team_ids : [];
    if (ids.length !== 2 || ids.some((x) => typeof x !== 'string' || !isUuid(x)) || ids[0] === ids[1]) {
      return res.status(400).json({ error: 'A decider match is for exactly two teams level on every tie-break. With more, draw lots.', code: 'BAD_DECIDER' });
    }
    const teamIds = ids as string[];
    const { data: ents } = await supabase.from('tournament_entries').select('team_id, group_label, status').eq('tournament_id', id).in('team_id', teamIds).eq('status', 'approved');
    const inGroup = ((ents ?? []) as Array<{ team_id: string; group_label: string | null }>).filter((e) => !group || (e.group_label ?? '') === group);
    if (new Set(inGroup.map((e) => e.team_id)).size !== 2) return res.status(400).json({ error: group ? `Both teams must be in group ${group}.` : 'Both teams must be in this tournament.', code: 'BAD_DECIDER' });

    const cur = settingsOf(t);
    const open = (cur.deciders ?? []).filter((d) => d.group === group && !d.closed);
    if (open.length) {
      const { data: ms } = await supabase.from('matches').select('id, status, voided_at').in('id', open.map((d) => d.match_id));
      const live = ((ms ?? []) as Array<{ id: string; status: string; voided_at: string | null }>).find((m) => (m.status === 'scheduled' || m.status === 'live') && !m.voided_at);
      if (live) return res.status(409).json({ error: 'This decider match is already set. Play it, or draw lots instead.', code: 'DECIDER_OPEN', match_id: live.id });
    }

    const { data: teams } = await supabase.from('teams').select('id, name').in('id', teamIds);
    const nameOf = (tid: string) => ((teams ?? []) as Array<{ id: string; name: string }>).find((x) => x.id === tid)?.name ?? null;
    const slug = normSportSlug((await getSport(String(t.sport_id)))?.slug);
    const rules = fixtureRulesFor(slug, t.match_rules ?? null, 'group', t.entry_kind);
    const legacy = legacyFromRules(slug, rules);
    const now = new Date().toISOString();
    const { data: made, error } = await supabase.from('matches').insert({
      sport_id: t.sport_id, tournament_id: null, team_a_id: teamIds[0], team_b_id: teamIds[1],
      team_a_name: nameOf(teamIds[0]!), team_b_name: nameOf(teamIds[1]!),
      scheduled_at: now, venue: t.venue ?? null, city_id: t.city_id ?? null,
      format: legacy.format, ...(slug === 'cricket' ? { overs: legacy.overs } : {}), rules,
      status: 'scheduled', is_open: false, players_needed: 0, is_ranked: false, join_policy: 'open', created_by: userId,
    }).select('id').single();
    if (error || !made) return res.status(500).json({ error: 'Couldn’t set the decider match. Try again.' });
    const matchId = (made as { id: string }).id;
    // A singles / doubles event: the entries' players are the line-up (as its fixtures, fillEntryLineups).
    if (t.entry_kind === 'singles' || t.entry_kind === 'doubles') {
      const { data: mem } = await supabase.from('team_members').select('team_id, user_id').in('team_id', teamIds);
      const rows = ((mem ?? []) as Array<{ team_id: string; user_id: string }>).map((r) => ({ match_id: matchId, user_id: r.user_id, team_side: r.team_id === teamIds[0] ? 'A' : 'B' }));
      if (rows.length) await supabase.from('match_participants').upsert(rows, { onConflict: 'match_id,user_id' });
    }
    const deciders: Decider[] = [...(cur.deciders ?? []), { group, match_id: matchId, team_ids: teamIds }];
    const next = storedSettings({ deciders }, cur);
    const { error: sErr } = await supabase.from('tournaments').update({ settings: next }).eq('id', id);
    if (sErr) return res.status(500).json({ error: 'Couldn’t set the decider match. Try again.' });
    return res.status(201).json({ match_id: matchId, deciders: next.deciders ?? [] });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Writes each finished decider's winner into the group's draw-of-lots order (once), then what follows
 * a draw (crowning, seeding). Returns the settings as they are now, and each group's latest decider.
 */
export async function applyDeciders(t: T): Promise<{ settings: ReturnType<typeof settingsOf>; view: DeciderView[] }> {
  const cur = settingsOf(t);
  const list = cur.deciders ?? [];
  if (!list.length) return { settings: cur, view: [] };
  const { data: ms } = await supabase.from('matches').select('id, status, winner_team_id, voided_at, team_a_id, team_b_id').in('id', list.map((d) => d.match_id));
  const byId = new Map(((ms ?? []) as M[]).map((m) => [m.id, m]));
  const lots = { ...(cur.lots ?? {}) };
  let changed = false;
  const deciders = list.map((d) => {
    const m = byId.get(d.match_id);
    const w = m && m.status === 'completed' && !m.voided_at ? m.winner_team_id : null;
    if (d.closed || !w || !d.team_ids.includes(w) || d.applied === w) return d;
    lots[d.group] = [w, ...d.team_ids.filter((x) => x !== w)];
    changed = true;
    return { ...d, applied: w };
  });
  let settings = cur;
  if (changed) {
    settings = storedSettings({ lots, deciders }, cur);
    const { error } = await supabase.from('tournaments').update({ settings }).eq('id', t.id);
    if (error) settings = cur;
    else await afterLots(t.id, { ...t, settings });
  }
  const latest = new Map<string, Decider>();
  for (const d of settings.deciders ?? []) latest.set(d.group, d);
  const view = [...latest.values()].map((d) => {
    const m = byId.get(d.match_id);
    return { group: d.group || null, match_id: d.match_id, team_ids: d.team_ids, status: m?.voided_at ? 'voided' : m?.status ?? 'scheduled', winner_team_id: m && !m.voided_at && m.status === 'completed' ? m.winner_team_id : null, closed: !!d.closed };
  });
  return { settings, view };
}

/** After a match outside any tournament finishes: if it is a decider, its tournament takes the result. */
export async function deciderAfterResult(matchId: string): Promise<void> {
  try {
    const { data } = await supabase.from('tournaments').select('id, sport_id, settings, format, status, champion_team_id')
      .contains('settings', { deciders: [{ match_id: matchId }] }).limit(1);
    const t = ((data ?? []) as T[])[0];
    if (t) await applyDeciders(t);
  } catch { /* best effort: the table applies it when it's next read */ }
}
