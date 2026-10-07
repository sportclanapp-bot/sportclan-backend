/**
 * Stage 8 · F11 (Oct 2026) · a match's assistant officials and its official's
 * report, in each sport's own words (utils/sportTerms).
 *
 *   GET /matches/:id/assistants  → { roles: [{ key, label, user }], report, official }
 *   PUT /matches/:id/assistants  { assignments: [{ role, user_id | null }] }
 *       The organiser (or a casual match's creator) names or clears each role
 *       the sport has (assistant_referee_1, fourth_official, line_judge…), while
 *       the match is scheduled or live. A replaced or cleared person is soft-
 *       removed (removed_at). A ranked match's assistants don't play in it.
 *   PUT /matches/:id/report  { text }
 *       The match official, an assistant, the scorer or the organiser writes a
 *       short report (cautions, sendings-off, incidents) — up to 2000 characters.
 *       Any time, also after the match. Stored on matches.official_report.
 *       Only the officials, scorer and organiser see it (it can name players
 *       for misconduct); everyone sees who the assistants are.
 */
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { isTournamentOrganiser, canOfficiateMatch } from '../utils/tournamentAuth';
import { notifyUser } from '../utils/notify';
import { sportSlugOf } from '../utils/sportSlug';
import { sportTerms, isAssistantRole } from '../utils/sportTerms';

export const REPORT_MAX = 2000;

type MatchRow = {
  id: string; sport_id: string | null; tournament_id: string | null; created_by: string | null; status: string;
  umpire_id: string | null; scorer_id: string | null; is_ranked: boolean | null; team_a_name: string | null; team_b_name: string | null;
  official_report: { text?: string; by?: string; at?: string } | null;
};
const COLS = 'id, sport_id, tournament_id, created_by, status, umpire_id, scorer_id, is_ranked, team_a_name, team_b_name, official_report';

async function loadMatch(id: string): Promise<MatchRow | null> {
  if (!isUuid(id)) return null;
  const { data } = await supabase.from('matches').select(COLS).eq('id', id).maybeSingle();
  return (data as MatchRow | null) ?? null;
}

async function canName(m: MatchRow, userId: string): Promise<boolean> {
  return m.tournament_id ? isTournamentOrganiser(m.tournament_id, userId) : m.created_by === userId;
}

async function liveAssistants(matchId: string) {
  const { data } = await supabase.from('match_officials').select('id, role, user_id').eq('match_id', matchId).is('removed_at', null);
  return (data ?? []) as Array<{ id: string; role: string; user_id: string }>;
}

async function people(ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; name: string | null; username: string | null }>();
  const { data } = await supabase.from('users').select('id, name, username, deleted_at').in('id', ids);
  return new Map(((data ?? []) as Array<{ id: string; name: string | null; username: string | null; deleted_at: string | null }>)
    .filter((u) => !u.deleted_at).map((u) => [u.id, { id: u.id, name: u.name, username: u.username }]));
}

async function view(m: MatchRow, viewerId: string) {
  const sport = await sportSlugOf(m.sport_id);
  const terms = sportTerms(sport);
  const rows = await liveAssistants(m.id);
  const canReport = rows.some((r) => r.user_id === viewerId) || (await canOfficiateMatch(m, viewerId));
  const ids = [...new Set([...rows.map((r) => r.user_id), ...(m.official_report?.by ? [m.official_report.by] : [])])];
  const who = await people(ids);
  return {
    official: terms.official,
    roles: terms.assistants.map((a) => {
      const r = rows.find((x) => x.role === a.key);
      return { key: a.key, label: a.label, user: r ? who.get(r.user_id) ?? null : null };
    }),
    can_report: canReport,
    report: canReport && m.official_report?.text ? { text: m.official_report.text, at: m.official_report.at ?? null, by: m.official_report.by ? who.get(m.official_report.by) ?? null : null } : null,
  };
}

export async function getMatchAssistants(req: Request, res: Response) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const m = await loadMatch(String(req.params.id));
    if (!m) return res.status(404).json({ error: 'Match not found' });
    return res.json(await view(m, req.userId));
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function setMatchAssistants(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const m = await loadMatch(String(req.params.id));
    if (!m) return res.status(404).json({ error: 'Match not found' });
    const sport = await sportSlugOf(m.sport_id);
    const terms = sportTerms(sport);
    if (!(await canName(m, userId))) {
      return res.status(403).json({ error: m.tournament_id ? 'Only the tournament organiser can name a fixture’s officials.' : 'Only the match’s creator can name its officials.' });
    }
    if (m.status !== 'scheduled' && m.status !== 'live') return res.status(409).json({ error: 'This match is over, so its officials can’t change.', code: 'MATCH_FINISHED' });
    const list = Array.isArray((req.body ?? {}).assignments) ? (req.body.assignments as Array<{ role?: unknown; user_id?: unknown }>) : null;
    if (!list || list.length === 0) return res.status(400).json({ error: 'Send assignments: [{ role, user_id }].', code: 'NOTHING_TO_SET' });
    if (terms.assistants.length === 0) return res.status(400).json({ error: `${terms.official}s work alone in this sport.`, code: 'NO_ASSISTANTS' });
    const seen = new Set<string>();
    for (const a of list) {
      if (typeof a.role !== 'string' || !isAssistantRole(sport, a.role)) {
        return res.status(400).json({ error: `Pick one of: ${terms.assistants.map((x) => x.label).join(', ')}.`, code: 'BAD_ROLE' });
      }
      if (seen.has(a.role)) return res.status(400).json({ error: 'Each role once.', code: 'BAD_ROLE' });
      seen.add(a.role);
      if (a.user_id !== null && (typeof a.user_id !== 'string' || !isUuid(a.user_id))) return res.status(400).json({ error: 'An official must be a person on SportClan, or none.', code: 'BAD_OFFICIAL' });
    }
    const named = list.map((a) => a.user_id).filter((v): v is string => typeof v === 'string');
    const who = await people(named);
    for (const id of named) if (!who.has(id)) return res.status(404).json({ error: 'That person isn’t on SportClan.', code: 'OFFICIAL_NOT_FOUND' });
    if (m.is_ranked && named.length) {
      const { data: parts } = await supabase.from('match_participants').select('user_id').eq('match_id', m.id);
      const players = new Set(((parts ?? []) as Array<{ user_id: string }>).map((p) => p.user_id));
      if (named.some((id) => players.has(id))) return res.status(409).json({ error: 'They play in this ranked match, so they can’t officiate it.', code: 'OFFICIAL_IS_PLAYER' });
    }
    const now = new Date().toISOString();
    const current = await liveAssistants(m.id);
    const label = m.team_a_name && m.team_b_name ? `${m.team_a_name} vs ${m.team_b_name}` : 'a match';
    for (const a of list) {
      const role = a.role as string;
      const had = current.find((c) => c.role === role);
      if (had && had.user_id === a.user_id) continue;
      if (had) await supabase.from('match_officials').update({ removed_at: now }).eq('id', had.id);
      if (typeof a.user_id === 'string') {
        const { error } = await supabase.from('match_officials').insert({ match_id: m.id, user_id: a.user_id, role, named_by: userId });
        if (error) return res.status(500).json({ error: 'Couldn’t save the officials.' });
        if (a.user_id !== userId) {
          const roleLabel = terms.assistants.find((x) => x.key === role)?.label ?? 'Official';
          try {
            await notifyUser({ userId: a.user_id, type: 'match_official_assigned', title: `You’re ${roleLabel.toLowerCase()}`, body: `You’ve been named ${roleLabel.toLowerCase()} for ${label}.`, data: { matchId: m.id, screen: 'MatchDetail' } });
          } catch { /* best-effort */ }
        }
      }
    }
    return res.json(await view(m, userId));
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function setOfficialReport(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const m = await loadMatch(String(req.params.id));
    if (!m) return res.status(404).json({ error: 'Match not found' });
    const assistants = await liveAssistants(m.id);
    const allowed = assistants.some((a) => a.user_id === userId) || (await canOfficiateMatch(m, userId));
    if (!allowed) return res.status(403).json({ error: 'Only the match’s officials, scorer or organiser can write its report.' });
    const raw = (req.body ?? {}).text;
    if (typeof raw !== 'string') return res.status(400).json({ error: 'Send the report as text.', code: 'BAD_REPORT' });
    const text = raw.trim();
    if (text.length > REPORT_MAX) return res.status(400).json({ error: `A report is up to ${REPORT_MAX} characters.`, code: 'REPORT_TOO_LONG' });
    const report = text ? { text, by: userId, at: new Date().toISOString() } : null;
    const { data, error } = await supabase.from('matches').update({ official_report: report }).eq('id', m.id).select(COLS).single();
    if (error) return res.status(500).json({ error: 'Couldn’t save the report.' });
    return res.json(await view(data as MatchRow, userId));
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
