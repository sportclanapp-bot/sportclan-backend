/**
 * Stage 8 · F21 (Oct 2026) · the organiser's announcements, any sport.
 *   GET    /tournaments/:id/announcements?offset=&limit=   newest first, paged (20)
 *   POST   /tournaments/:id/announcements { body }         the organiser posts (1–1000 characters);
 *          every entrant's players, the co-organisers and the officials get it as a push
 *   DELETE /tournaments/:id/announcements/:aid             the organiser takes one down (soft delete)
 * A tournament made of events: an announcement on the tournament reaches every
 * event's entrants, and each event's page shows the tournament's announcements too.
 */
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { selectAllIn } from '../utils/selectAll';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { familyIds, rootTournamentId } from '../utils/tournamentEvents';
import { notifyUsers } from '../utils/notify';

export const BODY_MAX = 1000;
const PAGE = 20;

/** Everyone a tournament (and its events) should reach: entrants' players (of `ids`), and the whole tournament's organisers and officials (`family`). */
export async function tournamentAudience(rootId: string, ids: string[], family: string[] = ids): Promise<string[]> {
  const people = new Set<string>();
  const entries = await selectAllIn(ids, (c, f, to) => supabase.from('tournament_entries').select('id, team_id').in('tournament_id', c).in('status', ['approved', 'pending']).order('id').range(f, to));
  const teams = [...new Set(((entries ?? []) as Array<{ team_id: string | null }>).map((e) => e.team_id).filter((x): x is string => !!x))];
  if (teams.length) {
    const members = await selectAllIn(teams, (c, f, to) => supabase.from('team_members').select('team_id, user_id').in('team_id', c).order('team_id').range(f, to));
    for (const m of (members ?? []) as Array<{ user_id: string }>) people.add(m.user_id);
  }
  const { data: t } = await supabase.from('tournaments').select('created_by').eq('id', rootId).maybeSingle();
  if ((t as { created_by?: string } | null)?.created_by) people.add((t as { created_by: string }).created_by);
  const { data: orgs } = await supabase.from('tournament_organisers').select('user_id').in('tournament_id', family);
  for (const o of (orgs ?? []) as Array<{ user_id: string }>) people.add(o.user_id);
  const { data: offs } = await supabase.from('tournament_officials').select('user_id').in('tournament_id', family);
  for (const o of (offs ?? []) as Array<{ user_id: string }>) people.add(o.user_id);
  return [...people];
}

export async function listAnnouncements(req: Request, res: Response) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const limit = Math.min(PAGE, Math.max(1, Number(req.query.limit ?? PAGE) || PAGE));
    // An event shows its own and its tournament's.
    const root = await rootTournamentId(id);
    const scope = [...new Set([id, root])];
    const { data, error } = await supabase.from('tournament_announcements')
      .select('id, tournament_id, author_id, body, created_at')
      .in('tournament_id', scope).is('deleted_at', null)
      .order('created_at', { ascending: false }).range(offset, offset + limit);
    if (error) return res.status(500).json({ error: 'Couldn’t load the announcements.' });
    const rows = (data ?? []) as Array<{ id: string; tournament_id: string; author_id: string | null; body: string; created_at: string }>;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const authors = [...new Set(page.map((r) => r.author_id).filter((x): x is string => !!x))];
    const { data: us } = authors.length ? await supabase.from('users').select('id, name').in('id', authors) : { data: [] };
    const nm = new Map(((us ?? []) as Array<{ id: string; name: string | null }>).map((u) => [u.id, u.name]));
    return res.json({
      announcements: page.map((r) => ({ id: r.id, body: r.body, created_at: r.created_at, author: r.author_id ? nm.get(r.author_id) ?? null : null, from_tournament: r.tournament_id !== id })),
      next: more ? offset + limit : null,
      can_post: await isTournamentOrganiser(id, req.userId),
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function postAnnouncement(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const { data: t } = await supabase.from('tournaments').select('id, name').eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(id, userId))) return res.status(403).json({ error: 'Only the organiser can post announcements.' });
    const body = typeof (req.body ?? {}).body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ error: 'Write the announcement.', code: 'EMPTY' });
    if (body.length > BODY_MAX) return res.status(400).json({ error: `An announcement is up to ${BODY_MAX} characters.`, code: 'TOO_LONG' });
    const { data: row, error } = await supabase.from('tournament_announcements').insert({ tournament_id: id, author_id: userId, body }).select('id, body, created_at').single();
    if (error || !row) return res.status(500).json({ error: 'Couldn’t post the announcement.' });
    // Everyone in this tournament (and, for a tournament made of events, every event).
    const ids = await familyIds(id);
    const root = await rootTournamentId(id);
    const scope = id === root ? ids : [id];
    const audience = (await tournamentAudience(root, scope, ids)).filter((u) => u !== userId);
    void notifyUsers(audience, {
      type: 'tournament_announcement',
      title: `📣 ${(t as { name?: string }).name ?? 'Tournament'}`,
      body: body.length > 180 ? `${body.slice(0, 177)}…` : body,
      data: { tournamentId: id },
    }, { actorId: userId });
    return res.status(201).json({ announcement: row, told: audience.length });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteAnnouncement(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id); const aid = String(req.params.aid);
    if (!isUuid(id) || !isUuid(aid)) return res.status(404).json({ error: 'Not found' });
    if (!(await isTournamentOrganiser(id, userId))) return res.status(403).json({ error: 'Only the organiser can take an announcement down.' });
    const { data } = await supabase.from('tournament_announcements').update({ deleted_at: new Date().toISOString() }).eq('id', aid).eq('tournament_id', id).is('deleted_at', null).select('id').maybeSingle();
    if (!data) return res.status(404).json({ error: 'Announcement not found' });
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
