/**
 * Badminton gap 5 (Oct 2026) · order of play and call-ups at the venue.
 *
 * A badminton desk runs 4–12 courts: who's playing, who's been called, who's
 * next, which court is free. The organiser (or a co-organiser) calls a match
 * to its court — both sides and the umpire get "Court 3 now"; sends the next
 * ready match to a free court; and, when the day runs late, moves every
 * remaining match by N minutes and tells everyone once.
 *
 * Sport-neutral: courts are the tournament's grounds (ground_names). For a
 * tournament made of events, the board covers every event on the shared courts.
 */
import { selectAllIn } from '../utils/selectAll';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { notifyUsers, matchAudienceIds } from '../utils/notify';
import { familyIds, rootTournamentId } from '../utils/tournamentEvents';
import { formatTimeIst } from '../utils/scheduleFixtures';

type M = {
  id: string; tournament_id: string; team_a_id: string | null; team_b_id: string | null; team_a_name: string | null; team_b_name: string | null;
  scheduled_at: string | null; ground_label: string | null; status: string; called_at: string | null; called_by: string | null;
  round: number | null; umpire_id: string | null; scorer_id: string | null; voided_at: string | null; started_at?: string | null;
};
const M_COLS = 'id, tournament_id, team_a_id, team_b_id, team_a_name, team_b_name, scheduled_at, ground_label, status, called_at, called_by, round, umpire_id, scorer_id, voided_at';
const LATE_MIN = 5;
const LATE_MAX = 240;

/** Courts, in order: the tournament's grounds (named or numbered), then any other label a fixture carries. */
export function courtsOf(t: { ground_count?: number | null; ground_names?: string[] | null }, labels: Array<string | null>): string[] {
  const n = Math.max(1, Number(t.ground_count ?? 0) || 0, (t.ground_names ?? []).length);
  const named = Array.from({ length: n }, (_, i) => (t.ground_names && t.ground_names[i]) || `Ground ${i + 1}`);
  for (const l of labels) if (l && !named.includes(l)) named.push(l);
  return named;
}

const known = (m: M) => !!m.team_a_id && !!m.team_b_id;

/**
 * The board: each court with what's on it (playing, called) and its next
 * scheduled match; the matches ready to go (both sides known), earliest first.
 */
export function boardOf(courts: string[], matches: M[], labelOf: Map<string, string | null>, playersOf: Map<string, string[]> = new Map()) {
  const card = (m: M) => ({
    id: m.id, tournament_id: m.tournament_id, event_label: labelOf.get(m.tournament_id) ?? null,
    team_a_name: m.team_a_name, team_b_name: m.team_b_name, scheduled_at: m.scheduled_at, ground_label: m.ground_label,
    status: m.status, called_at: m.called_at, round: m.round, umpire_id: m.umpire_id,
  });
  const open = matches.filter((m) => !m.voided_at && (m.status === 'scheduled' || m.status === 'live'));
  const byTime = (a: M, b: M) => (Date.parse(a.scheduled_at ?? '') || Infinity) - (Date.parse(b.scheduled_at ?? '') || Infinity);
  // Busy by player, not team: a player in singles and doubles is one person.
  const people = (teamId: string | null) => (teamId ? playersOf.get(teamId) ?? [`team:${teamId}`] : []);
  const busy = new Set(open.filter((m) => m.status === 'live' || m.called_at).flatMap((m) => [...people(m.team_a_id), ...people(m.team_b_id)]));
  return {
    courts: courts.map((c) => {
      const here = open.filter((m) => m.ground_label === c);
      const playing = here.find((m) => m.status === 'live') ?? null;
      const called = here.filter((m) => m.status === 'scheduled' && m.called_at).sort(byTime)[0] ?? null;
      const next = here.filter((m) => m.status === 'scheduled' && !m.called_at).sort(byTime).slice(0, 3);
      return { label: c, playing: playing ? card(playing) : null, called: called ? card(called) : null, next: next.map((m) => ({ ...card(m), busy: known(m) && [...people(m.team_a_id), ...people(m.team_b_id)].some((p) => busy.has(p)) })), free: !playing && !called };
    }),
    // Ready: both sides known, not called, not on court; a team already playing or called waits.
    ready: open.filter((m) => m.status === 'scheduled' && !m.called_at && known(m)).sort(byTime)
      .map((m) => ({ ...card(m), busy: [...people(m.team_a_id), ...people(m.team_b_id)].some((p) => busy.has(p)) })),
  };
}

async function loadFamily(id: string) {
  const root = await rootTournamentId(id);
  const ids = await familyIds(root);
  const ts = await selectAllIn(ids, (c, f, to) => supabase.from('tournaments').select('id, name, event_label, ground_count, ground_names, is_parent').in('id', c).order('id').range(f, to));
  const rows = (ts ?? []) as Array<{ id: string; name: string; event_label: string | null; ground_count: number | null; ground_names: string[] | null; is_parent: boolean | null }>;
  const rootRow = rows.find((r) => r.id === root) ?? rows[0];
  const ms = await selectAllIn(ids, (c, f, to) => supabase.from('matches').select(M_COLS).in('tournament_id', c).order('id').range(f, to));
  const matches = (ms ?? []) as M[];
  const teamIds = [...new Set(matches.filter((m) => m.status === 'scheduled' || m.status === 'live').flatMap((m) => [m.team_a_id, m.team_b_id]).filter(Boolean) as string[])];
  const mem = await selectAllIn(teamIds, (c, f, to) => supabase.from('team_members').select('team_id, user_id').in('team_id', c).order('id').range(f, to));
  const playersOf = new Map<string, string[]>();
  for (const r of (mem ?? []) as Array<{ team_id: string; user_id: string }>) playersOf.set(r.team_id, [...(playersOf.get(r.team_id) ?? []), r.user_id]);
  return { root, ids, rootRow, labelOf: new Map(rows.map((r) => [r.id, r.event_label])), matches, playersOf };
}

// GET /tournaments/:id/court-board — anyone who can see the tournament.
export async function getCourtBoard(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const f = await loadFamily(id);
    if (!f.rootRow) return res.status(404).json({ error: 'Tournament not found' });
    const courts = courtsOf(f.rootRow, f.matches.map((m) => m.ground_label));
    return res.json({ ...boardOf(courts, f.matches, f.labelOf, f.playersOf), can_run: await isTournamentOrganiser(f.root, userId) });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** "Court 3 now: Ravi K vs Amit S" — to both sides and the match's umpire / scorer. */
async function announceCall(m: M, court: string, actorId: string) {
  const audience = await matchAudienceIds(m.id, m.team_a_id, m.team_b_id);
  const officials = [m.umpire_id, m.scorer_id].filter((x): x is string => !!x);
  await notifyUsers([...new Set([...audience, ...officials])], {
    type: 'match_called',
    title: `${court} now`,
    body: `${m.team_a_name ?? 'TBD'} vs ${m.team_b_name ?? 'TBD'} — please come to ${court}.`,
    data: { matchId: m.id, tournamentId: m.tournament_id, court },
  }, { actorId });
}

async function callMatch(m: M, court: string, userId: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('matches')
    .update({ called_at: now, called_by: userId, ground_label: court })
    .eq('id', m.id).eq('status', 'scheduled').select(M_COLS).maybeSingle();
  if (error || !data) return null;
  void announceCall({ ...m, ground_label: court }, court, userId);
  return data as M;
}

// POST /matches/:id/call { court? } — call a fixture to its court (or another).
export async function callToCourt(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Match not found' });
    const { data } = await supabase.from('matches').select(M_COLS).eq('id', id).maybeSingle();
    const m = data as M | null;
    if (!m || !m.tournament_id) return res.status(404).json({ error: 'Match not found' });
    if (!(await isTournamentOrganiser(m.tournament_id, userId))) return res.status(403).json({ error: 'Only the organiser can call matches.' });
    if (m.voided_at || m.status !== 'scheduled') return res.status(409).json({ error: 'Only a match that hasn’t started can be called.', code: 'NOT_SCHEDULED' });
    if (!known(m)) return res.status(409).json({ error: 'Both sides aren’t known yet.', code: 'SIDES_UNKNOWN' });
    const body = (req.body ?? {}) as { court?: unknown };
    const court = typeof body.court === 'string' && body.court.trim() ? body.court.trim().slice(0, 40) : m.ground_label;
    if (!court) return res.status(400).json({ error: 'Pick a court.', code: 'NO_COURT' });
    const called = await callMatch(m, court, userId);
    if (!called) return res.status(409).json({ error: 'This match has just started or changed. Refresh.', code: 'NOT_SCHEDULED' });
    return res.json({ match: called });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /matches/:id/uncall — undo a call (a wrong court, a no-show handled another way).
export async function uncallMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Match not found' });
    const { data } = await supabase.from('matches').select(M_COLS).eq('id', id).maybeSingle();
    const m = data as M | null;
    if (!m || !m.tournament_id) return res.status(404).json({ error: 'Match not found' });
    if (!(await isTournamentOrganiser(m.tournament_id, userId))) return res.status(403).json({ error: 'Only the organiser can change a call.' });
    await supabase.from('matches').update({ called_at: null, called_by: null }).eq('id', id).eq('status', 'scheduled');
    return res.json({ match: { ...m, called_at: null, called_by: null } });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /tournaments/:id/next-to-court { court } — the next ready match (earliest,
// both sides known, nobody in it on a court or called) goes to this court, called.
export async function nextToCourt(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const f = await loadFamily(id);
    if (!f.rootRow) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(f.root, userId))) return res.status(403).json({ error: 'Only the organiser can send matches to courts.' });
    const court = typeof req.body?.court === 'string' ? req.body.court.trim().slice(0, 40) : '';
    if (!court) return res.status(400).json({ error: 'Pick a court.', code: 'NO_COURT' });
    const board = boardOf(courtsOf(f.rootRow, f.matches.map((m) => m.ground_label)), f.matches, f.labelOf, f.playersOf);
    const here = board.courts.find((c) => c.label === court);
    if (here && !here.free) return res.status(409).json({ error: `${court} isn’t free.`, code: 'COURT_BUSY' });
    // Players, not just teams: a player in two events can't be on two courts.
    const nextCard = board.ready.find((r) => !r.busy);
    const next = nextCard ? f.matches.find((m) => m.id === nextCard.id) : undefined;
    if (!next) return res.status(409).json({ error: 'No match is ready — everyone due is playing or called.', code: 'NONE_READY' });
    const called = await callMatch(next, court, userId);
    if (!called) return res.status(409).json({ error: 'That match has just changed. Try again.', code: 'NOT_SCHEDULED' });
    return res.json({ match: called });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /tournaments/:id/running-late { minutes } — every match not yet started
// (and not called) moves N minutes later; everyone in them is told once.
export async function runningLate(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const minutes = Number(req.body?.minutes);
    if (!Number.isInteger(minutes) || minutes < LATE_MIN || minutes > LATE_MAX) {
      return res.status(400).json({ error: `Running late by ${LATE_MIN} to ${LATE_MAX} minutes.`, code: 'BAD_MINUTES' });
    }
    const f = await loadFamily(id);
    if (!f.rootRow) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(f.root, userId))) return res.status(403).json({ error: 'Only the organiser can move the schedule.' });
    const moving = f.matches.filter((m) => !m.voided_at && m.status === 'scheduled' && !m.called_at && m.scheduled_at);
    for (const m of moving) {
      const at = new Date(Date.parse(m.scheduled_at!) + minutes * 60000).toISOString();
      await supabase.from('matches').update({ scheduled_at: at }).eq('id', m.id).eq('status', 'scheduled');
    }
    if (moving.length) {
      const people = new Set<string>();
      for (const m of moving) for (const u of await matchAudienceIds(m.id, m.team_a_id, m.team_b_id)) people.add(u);
      const first = moving.map((m) => Date.parse(m.scheduled_at!) + minutes * 60000).sort((a, b) => a - b)[0]!;
      void notifyUsers([...people], {
        type: 'tournament_updated',
        title: `Running ${minutes} min late`,
        body: `${f.rootRow.name ?? 'The tournament'} is running ${minutes} minutes late. Every match not yet started moves ${minutes} minutes later — the next is at ${formatTimeIst(new Date(first).toISOString())}.`,
        data: { tournamentId: f.root },
      }, { actorId: userId });
    }
    return res.json({ moved: moving.length, minutes });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
