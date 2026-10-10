/**
 * Stage 8 · F3 / F16 / F5 (Oct 2026) · squads, ID checks and bans.
 *
 *   GET   /tournaments/:id/squads/:teamId        the team's squad (saved, or its members suggested), the size,
 *                                                 whether it's locked, who can edit / check, and open bans
 *   PUT   /tournaments/:id/squads/:teamId        { players: [{ user_id? | guest_name?, jersey_number? }] }
 *                                                 the captain (until the squad locks) or the organiser (always)
 *   PATCH /tournaments/:id/squads/:teamId/check  { player: rowId | 'member:<userId>', checked, note? }
 *                                                 the organiser's ID check (F16) — saves the squad first if needed
 *   PUT   /tournaments/:id/squad-lock            { locked } — the organiser locks or reopens squads by hand
 *   GET   /tournaments/:id/discipline            the cards table and the bans still to serve (F5)
 *   GET   /matches/:id/banned                    who is banned from this fixture, per side (F5)
 * Any sport whose entries are teams. Soft deletes only (removed_at).
 */
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { allRows, selectAllIn } from '../utils/selectAll';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { settingsOf, storedSettings, womenOnCourtProblem, type SquadRules } from '../utils/tournamentSettings';
import { possessive } from '../utils/possessive';
import { disciplineRecords, bannedFrom, openBans, type DMatch, type DCard } from '../utils/discipline';

const NAME_MAX = 60; const NOTE_MAX = 200;
type T = { id: string; settings: unknown; fixtures_generated: boolean | null; registration_deadline: string | null; entry_kind: string | null; format: string | null };
type Row = { id: string; team_id: string; user_id: string | null; guest_name: string | null; jersey_number: number | null; id_checked_at: string | null; id_checked_by: string | null; id_note: string | null };

/** Pure: is the squad closed to captains now? */
export function squadLocked(t: Pick<T, 'settings' | 'fixtures_generated' | 'registration_deadline'>, now = Date.now()): boolean {
  const q: SquadRules = settingsOf(t as { settings?: unknown }).squad ?? {};
  const lock = q.lock ?? 'draw';
  if (lock === 'never') return false;
  if (lock === 'manual') return !!q.lockedAt;
  if (lock === 'deadline') return !!t.registration_deadline && Date.parse(t.registration_deadline) < now;
  return !!t.fixtures_generated;
}

async function loadT(id: string): Promise<T | null> {
  if (!isUuid(id)) return null;
  const { data } = await supabase.from('tournaments').select('id, settings, fixtures_generated, registration_deadline, entry_kind, format').eq('id', id).maybeSingle();
  return (data as T | null) ?? null;
}
async function isEntered(tid: string, teamId: string): Promise<boolean> {
  const { data } = await supabase.from('tournament_entries').select('team_id').eq('tournament_id', tid).eq('team_id', teamId).in('status', ['approved', 'pending', 'withdrawn']).limit(1);
  return (data ?? []).length > 0;
}
async function isCaptain(teamId: string, userId: string): Promise<boolean> {
  const { data } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).in('role', ['captain', 'vice_captain']).limit(1);
  if ((data ?? []).length) return true;
  const { data: t } = await supabase.from('teams').select('created_by').eq('id', teamId).maybeSingle();
  return !!t && (t as { created_by?: string }).created_by === userId;
}
async function savedRows(tid: string, teamId: string): Promise<Row[]> {
  const { data } = await supabase.from('tournament_squads').select('id, team_id, user_id, guest_name, jersey_number, id_checked_at, id_checked_by, id_note').eq('tournament_id', tid).eq('team_id', teamId).is('removed_at', null).order('created_at');
  return (data ?? []) as Row[];
}
async function memberRows(teamId: string): Promise<Array<{ user_id: string; jersey_number: number | null }>> {
  const rows = await allRows(() => supabase.from('team_members').select('user_id, jersey_number').eq('team_id', teamId));
  return (rows ?? []) as Array<{ user_id: string; jersey_number: number | null }>;
}
async function names(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await selectAllIn(ids, (c, f, to) => supabase.from('users').select('id, name, deleted_at').in('id', c).order('id').range(f, to));
  return new Map(((rows ?? []) as Array<{ id: string; name: string | null; deleted_at: string | null }>).filter((u) => !u.deleted_at).map((u) => [u.id, u.name ?? 'Player']));
}

/** F5: the tournament's discipline records (bans) from its fixtures and cards. */
async function records(tid: string, t: T) {
  const ms = await allRows(() => supabase.from('matches').select('id, team_a_id, team_b_id, status, round, group_label, scheduled_at, match_no, voided_at, result_type').eq('tournament_id', tid));
  const list = ((ms ?? []) as Array<{ id: string; team_a_id: string | null; team_b_id: string | null; status: string; round: number | null; group_label: string | null; scheduled_at: string | null; match_no: number | null; voided_at: string | null }>)
    .filter((m) => !m.voided_at)
    .sort((a, b) => ((a.group_label != null || (a.round ?? 0) === 0) === (b.group_label != null || (b.round ?? 0) === 0) ? 0 : (a.group_label != null || (a.round ?? 0) === 0) ? -1 : 1)
      || (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '') || (a.round ?? 0) - (b.round ?? 0) || (a.match_no ?? 0) - (b.match_no ?? 0) || a.id.localeCompare(b.id));
  const knockoutFmt = t.format === 'knockout';
  const dm: DMatch[] = list.map((m) => ({ id: m.id, team_a_id: m.team_a_id, team_b_id: m.team_b_id, knockout: knockoutFmt || (m.group_label == null && (m.round ?? 0) >= 1 && t.format === 'groups_knockout'), played: m.status === 'completed' || m.status === 'abandoned' }));
  const played = dm.filter((m) => m.played).map((m) => m.id);
  const cards = played.length ? await selectAllIn(played, (c, f, to) => supabase.from('match_events').select('id, match_id, payload').eq('event_type', 'card').in('match_id', c).order('id').range(f, to)) : [];
  const enabled = !!settingsOf(t as { settings?: unknown }).discipline;
  return { enabled, recs: enabled ? disciplineRecords(settingsOf(t as { settings?: unknown }).discipline, dm, (cards ?? []) as DCard[]) : [], played: new Set(played), allRecs: disciplineRecords({ yellowsForBan: null, redBanMatches: 0 }, dm, (cards ?? []) as DCard[]) };
}

export async function getSquad(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tid = String(req.params.id); const teamId = String(req.params.teamId);
    const t = await loadT(tid);
    if (!t || !isUuid(teamId)) return res.status(404).json({ error: 'Not found' });
    if (t.entry_kind === 'singles' || t.entry_kind === 'doubles') return res.status(400).json({ error: 'Players and pairs enter this one — there are no squads.', code: 'NO_SQUADS' });
    if (!(await isEntered(tid, teamId))) return res.status(404).json({ error: 'That team isn’t in this tournament.' });
    const organiser = await isTournamentOrganiser(tid, userId);
    const captain = await isCaptain(teamId, userId);
    const locked = squadLocked(t);
    const saved = await savedRows(tid, teamId);
    const rows = saved.length ? saved : (await memberRows(teamId)).map((m) => ({ id: `member:${m.user_id}`, team_id: teamId, user_id: m.user_id, guest_name: null, jersey_number: m.jersey_number, id_checked_at: null, id_checked_by: null, id_note: null }));
    const nm = await names(rows.map((r) => r.user_id).filter((x): x is string => !!x));
    const { data: team } = await supabase.from('teams').select('id, name').eq('id', teamId).maybeSingle();
    const disc = await records(tid, t);
    const bans = openBans(disc.recs, disc.played).filter((b) => b.team_id === teamId);
    const q = settingsOf(t as { settings?: unknown }).squad ?? {};
    return res.json({
      team: team ?? { id: teamId, name: 'Team' },
      saved: saved.length > 0,
      size: q.size ?? null, lock: q.lock ?? 'draw', locked,
      can_edit: organiser || (captain && !locked), can_check: organiser,
      players: rows.map((r) => ({
        id: r.id, user_id: r.user_id, name: r.user_id ? nm.get(r.user_id) ?? 'Player' : r.guest_name ?? 'Player', guest: !r.user_id,
        jersey_number: r.jersey_number, id_checked: !!r.id_checked_at, id_note: r.id_note,
        banned: bans.find((b) => (r.user_id ? b.user_id === r.user_id : !b.user_id && b.name.toLowerCase() === (r.guest_name ?? '').toLowerCase()))?.reason ?? null,
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function setSquad(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tid = String(req.params.id); const teamId = String(req.params.teamId);
    const t = await loadT(tid);
    if (!t || !isUuid(teamId)) return res.status(404).json({ error: 'Not found' });
    if (t.entry_kind === 'singles' || t.entry_kind === 'doubles') return res.status(400).json({ error: 'Players and pairs enter this one — there are no squads.', code: 'NO_SQUADS' });
    if (!(await isEntered(tid, teamId))) return res.status(404).json({ error: 'That team isn’t in this tournament.' });
    const organiser = await isTournamentOrganiser(tid, userId);
    if (!organiser) {
      if (!(await isCaptain(teamId, userId))) return res.status(403).json({ error: 'Only the team’s captain or the organiser can set the squad.' });
      if (squadLocked(t)) return res.status(409).json({ error: 'Squads are locked — ask the organiser to change it.', code: 'SQUAD_LOCKED' });
    }
    const list = Array.isArray((req.body ?? {}).players) ? (req.body.players as Array<{ user_id?: unknown; guest_name?: unknown; jersey_number?: unknown }>) : null;
    if (!list) return res.status(400).json({ error: 'Send the players.', code: 'BAD_SQUAD' });
    const clean: Array<{ user_id: string | null; guest_name: string | null; jersey_number: number | null }> = [];
    const seenU = new Set<string>(); const seenG = new Set<string>();
    for (const p of list) {
      const uid = typeof p.user_id === 'string' && isUuid(p.user_id) ? p.user_id : null;
      const g = typeof p.guest_name === 'string' ? p.guest_name.trim() : '';
      if (!uid && !g) return res.status(400).json({ error: 'Each player is someone on SportClan or a name.', code: 'BAD_SQUAD' });
      if (g.length > NAME_MAX) return res.status(400).json({ error: `A name is up to ${NAME_MAX} characters.`, code: 'BAD_SQUAD' });
      const jn = p.jersey_number == null || p.jersey_number === '' ? null : Number(p.jersey_number);
      if (jn != null && (!Number.isInteger(jn) || jn < 0)) return res.status(400).json({ error: 'A shirt number is a whole number.', code: 'BAD_SQUAD' });
      if (uid) { if (seenU.has(uid)) continue; seenU.add(uid); } else { const k = g.toLowerCase(); if (seenG.has(k)) continue; seenG.add(k); }
      clean.push({ user_id: uid, guest_name: uid ? null : g, jersey_number: jn });
    }
    const size = settingsOf(t as { settings?: unknown }).squad?.size;
    if (size != null && clean.length > size) return res.status(409).json({ error: `A squad is at most ${size} players in this tournament.`, code: 'SQUAD_TOO_BIG' });
    // An account is in one squad per tournament.
    const uids = clean.map((c) => c.user_id).filter((x): x is string => !!x);
    if (uids.length) {
      const nm = await names(uids);
      const missing = uids.find((u) => !nm.has(u));
      if (missing) return res.status(404).json({ error: 'That player isn’t on SportClan.', code: 'PLAYER_NOT_FOUND' });
      const others = await selectAllIn(uids, (c, f, to) => supabase.from('tournament_squads').select('id, team_id, user_id').eq('tournament_id', tid).is('removed_at', null).in('user_id', c).order('id').range(f, to));
      const clash = ((others ?? []) as Array<{ team_id: string; user_id: string }>).find((o) => o.team_id !== teamId);
      if (clash) return res.status(409).json({ error: `${nm.get(clash.user_id) ?? 'A player'} is already in another team’s squad.`, code: 'IN_OTHER_SQUAD' });
    }
    const now = new Date().toISOString();
    const cur = await savedRows(tid, teamId);
    const keyOf = (r: { user_id: string | null; guest_name: string | null }) => (r.user_id ? `u:${r.user_id}` : `g:${(r.guest_name ?? '').toLowerCase()}`);
    const want = new Map(clean.map((c) => [keyOf(c), c]));
    for (const r of cur) {
      const w = want.get(keyOf(r));
      if (!w) await supabase.from('tournament_squads').update({ removed_at: now }).eq('id', r.id);
      else if ((w.jersey_number ?? null) !== (r.jersey_number ?? null)) await supabase.from('tournament_squads').update({ jersey_number: w.jersey_number }).eq('id', r.id);
      want.delete(keyOf(r));
    }
    const add = [...want.values()].map((c) => ({ tournament_id: tid, team_id: teamId, ...c, added_by: userId }));
    if (add.length) {
      const { error } = await supabase.from('tournament_squads').insert(add);
      if (error) return res.status(409).json({ error: 'A player is already in another team’s squad.', code: 'IN_OTHER_SQUAD' });
    }
    req.params.teamId = teamId;
    return getSquad(req, res);
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function checkSquadPlayer(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tid = String(req.params.id); const teamId = String(req.params.teamId);
    const t = await loadT(tid);
    if (!t || !isUuid(teamId)) return res.status(404).json({ error: 'Not found' });
    if (!(await isTournamentOrganiser(tid, userId))) return res.status(403).json({ error: 'Only the organiser checks IDs.' });
    const body = (req.body ?? {}) as { player?: unknown; checked?: unknown; note?: unknown };
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > NOTE_MAX) return res.status(400).json({ error: `A note is up to ${NOTE_MAX} characters.` });
    let rowId = typeof body.player === 'string' ? body.player : '';
    if (rowId.startsWith('member:')) {
      // Not saved yet: the organiser's check saves the team's members as its squad first.
      const uid = rowId.slice(7);
      let rows = await savedRows(tid, teamId);
      if (!rows.length) {
        const members = await memberRows(teamId);
        if (members.length) await supabase.from('tournament_squads').insert(members.map((m) => ({ tournament_id: tid, team_id: teamId, user_id: m.user_id, jersey_number: m.jersey_number, added_by: userId })));
        rows = await savedRows(tid, teamId);
      }
      rowId = rows.find((r) => r.user_id === uid)?.id ?? '';
    }
    const { data: row } = await supabase.from('tournament_squads').select('id').eq('id', rowId).eq('tournament_id', tid).eq('team_id', teamId).is('removed_at', null).maybeSingle();
    if (!row) return res.status(404).json({ error: 'That player isn’t in the squad.' });
    const checked = body.checked === true;
    await supabase.from('tournament_squads').update(checked ? { id_checked_at: new Date().toISOString(), id_checked_by: userId, id_note: note || null } : { id_checked_at: null, id_checked_by: null, id_note: note || null }).eq('id', rowId);
    return getSquad(req, res);
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function setSquadLock(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tid = String(req.params.id);
    const t = await loadT(tid);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(tid, userId))) return res.status(403).json({ error: 'Only the organiser can lock squads.' });
    const cur = settingsOf(t as { settings?: unknown });
    const locked = (req.body ?? {}).locked === true;
    const next = storedSettings({ squad: { ...(cur.squad ?? {}), lock: 'manual', lockedAt: locked ? new Date().toISOString() : null } }, cur);
    await supabase.from('tournaments').update({ settings: next }).eq('id', tid);
    return res.json({ squad: next.squad, locked: squadLocked({ ...t, settings: next }) });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getDiscipline(req: Request, res: Response) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tid = String(req.params.id);
    const t = await loadT(tid);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const d = await records(tid, t);
    const teamIds = [...new Set(d.allRecs.map((r) => r.team_id))];
    const { data: teams } = teamIds.length ? await supabase.from('teams').select('id, name').in('id', teamIds) : { data: [] };
    const tn = new Map(((teams ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]));
    const nm = await names(d.allRecs.map((r) => r.user_id).filter((x): x is string => !!x));
    const who = (r: { user_id: string | null; name: string }) => (r.user_id ? nm.get(r.user_id) ?? r.name : r.name);
    return res.json({
      enabled: d.enabled,
      rules: settingsOf(t as { settings?: unknown }).discipline ?? null,
      cautions: d.allRecs.filter((r) => r.yellows || r.reds).sort((a, b) => b.reds - a.reds || b.yellows - a.yellows || who(a).localeCompare(who(b)))
        .map((r) => ({ user_id: r.user_id, name: who(r), team_id: r.team_id, team_name: tn.get(r.team_id) ?? null, yellows: r.yellows, reds: r.reds })),
      banned: openBans(d.recs, d.played).map((b) => ({ user_id: b.user_id, name: who(b), team_id: b.team_id, team_name: tn.get(b.team_id) ?? null, reason: b.reason, matches_left: Math.max(b.remaining.length, 1), next_match_id: b.remaining[0] ?? null })),
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getBannedForMatch(req: Request, res: Response) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const mid = String(req.params.id);
    if (!isUuid(mid)) return res.status(404).json({ error: 'Match not found' });
    const { data: m } = await supabase.from('matches').select('id, tournament_id, team_a_id, team_b_id').eq('id', mid).maybeSingle();
    if (!m || !(m as { tournament_id?: string }).tournament_id) return res.json({ A: [], B: [] });
    const t = await loadT((m as { tournament_id: string }).tournament_id);
    if (!t) return res.json({ A: [], B: [] });
    const d = await records(t.id, t);
    const list = bannedFrom(d.recs, mid);
    const nm = await names(list.map((b) => b.user_id).filter((x): x is string => !!x));
    const row = (b: (typeof list)[number]) => ({ user_id: b.user_id, name: b.user_id ? nm.get(b.user_id) ?? b.name : b.name, reason: b.reason });
    return res.json({ A: list.filter((b) => b.team_id === (m as { team_a_id: string }).team_a_id).map(row), B: list.filter((b) => b.team_id === (m as { team_b_id: string }).team_b_id).map(row) });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * F3 · a team sheet's problem, or null: a player not in their team's saved
 * squad, or more starters (not marked 'sub') than the players a side the rules
 * say (football, hockey, basketball, volleyball; cricket and badminton keep
 * their own line-up rules). `current` is the line-up already stored.
 */
export async function teamSheetProblem(
  match: { tournament_id?: string | null; team_a_id?: string | null; team_b_id?: string | null; team_a_name?: string | null; team_b_name?: string | null },
  incoming: Array<{ user_id: string; team_side: 'A' | 'B'; role?: string | null }>,
  current: Array<{ user_id: string; team_side: string; role?: string | null }>,
  sport: string, playersASide: number | null | undefined,
): Promise<{ error: string; code: string } | null> {
  if (!match.tournament_id) return null;
  const sideTeam = { A: match.team_a_id ?? null, B: match.team_b_id ?? null };
  const sideName = { A: match.team_a_name ?? 'Team A', B: match.team_b_name ?? 'Team B' };
  for (const side of ['A', 'B'] as const) {
    const team = sideTeam[side];
    if (!team) continue;
    const rows = await savedRows(match.tournament_id, team);
    if (!rows.length) continue;
    const inSquad = new Set(rows.map((r) => r.user_id).filter(Boolean));
    const out = incoming.find((p) => p.team_side === side && !inSquad.has(p.user_id));
    if (out) {
      const nm = await names([out.user_id]);
      return { error: `${nm.get(out.user_id) ?? 'That player'} isn’t in ${possessive(sideName[side])} squad.`, code: 'NOT_IN_SQUAD' };
    }
  }
  if (playersASide && ['football', 'hockey', 'basketball', 'volleyball'].includes(sport)) {
    const merged = new Map(current.map((c) => [c.user_id, c]));
    for (const p of incoming) merged.set(p.user_id, { user_id: p.user_id, team_side: p.team_side, role: p.role ?? null });
    for (const side of ['A', 'B'] as const) {
      const starters = [...merged.values()].filter((c) => c.team_side === side && c.role !== 'sub').length;
      if (starters > playersASide) return { error: `${sideName[side]} have ${starters} starting — it’s ${playersASide} a side. Mark the rest as subs.`, code: 'TOO_MANY_STARTERS' };
    }
  }
  // Stage 14 · VB11: a co-ed event's women on court — each side's starters (not marked 'sub'), by their profiles.
  const t = await loadT(match.tournament_id);
  const cat = t ? settingsOf(t as { settings?: unknown }).category : null;
  if (cat?.minWomen) {
    const merged = new Map(current.map((c) => [c.user_id, c]));
    for (const p of incoming) merged.set(p.user_id, { user_id: p.user_id, team_side: p.team_side, role: p.role ?? null });
    for (const side of ['A', 'B'] as const) {
      const ids = [...merged.values()].filter((c) => c.team_side === side && c.role !== 'sub').map((c) => c.user_id);
      if (!ids.length) continue;
      const users = await selectAllIn(ids, (c, f, to) => supabase.from('users').select('id, gender').in('id', c).order('id').range(f, to));
      const why = womenOnCourtProblem(cat, ((users ?? []) as Array<{ gender?: string | null }>), sideName[side]);
      if (why) return { error: why, code: 'TOO_FEW_WOMEN' };
    }
  }
  return null;
}
