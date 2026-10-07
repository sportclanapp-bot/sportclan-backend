/**
 * Stage 8 · F12 (Oct 2026) · deciding an abandoned (or unplayable) match, any
 * sport. POST /matches/:id/decide
 *   { decision: 'stands', reason }            — the score when it stopped is the result
 *   { decision: 'replay', reason, at? }       — play the rest later: back to scheduled,
 *                                               the score and events kept (the pad resumes)
 *   { decision: 'awarded', reason, winner_side, score? } — the match goes to one
 *       side (a no-show, an ineligible player, the committee's call): the winner,
 *       an optional score ({A,B}; football's default is its walkover score, e.g.
 *       3–0) and the reason.
 * The organiser (or a casual match's creator) decides; a scheduled, live or
 * abandoned match only — a finished one is voided to take it off the table.
 * A decided match doesn't move ratings (they're scored on a played completion).
 * A knockout match can't end level, so "stands" needs a winner there; the
 * winner advances as with any result. The decision and reason stay on the
 * match (score_summary.decision) for its page and the table's notes.
 */
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { getSport, normSportSlug } from '../utils/sportCache';
import { rulesOf } from '../utils/matchRules';
import { withWalkoverScore } from '../utils/walkoverScore';
import { isKnockoutBracketMatch } from '../utils/knockout';
import { advanceTournamentWinner, tournamentSettingsOf } from './tournaments.controller';
import { notifyUsers, matchAudienceIds } from '../utils/notify';

export const REASON_MAX = 200;
const COLS = 'id, sport_id, tournament_id, created_by, status, round, group_label, next_match_id, team_a_id, team_b_id, team_a_name, team_b_name, format, overs, rules, score_summary, voided_at';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** The score a match has now (goal sports' A.score; a set sport's sets won), for "result stands". */
export function scoreNow(ss: Record<string, any> | null | undefined): { A: number; B: number } | null {
  if (!ss) return null;
  const a = num(ss.team_a_score ?? ss.A?.score ?? ss.A?.value);
  const b = num(ss.team_b_score ?? ss.B?.score ?? ss.B?.value);
  if (a != null && b != null) return { A: a, B: b };
  const sa = Array.isArray(ss.A?.sets) ? ss.A.sets : null; const sb = Array.isArray(ss.B?.sets) ? ss.B.sets : null;
  if (sa && sb) {
    let A = 0; let B = 0;
    for (let i = 0; i < Math.min(sa.length, sb.length); i++) { if (Number(sa[i]) > Number(sb[i])) A++; else if (Number(sb[i]) > Number(sa[i])) B++; }
    return { A, B };
  }
  return null;
}

export async function decideMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Match not found' });
    const { data } = await supabase.from('matches').select(COLS).eq('id', id).maybeSingle();
    const m = data as Record<string, any> | null;
    if (!m) return res.status(404).json({ error: 'Match not found' });
    const allowed = m.tournament_id ? await isTournamentOrganiser(m.tournament_id, userId) : m.created_by === userId;
    if (!allowed) return res.status(403).json({ error: m.tournament_id ? 'Only the tournament organiser can decide a match.' : 'Only the match’s creator can decide it.' });
    if (m.voided_at) return res.status(409).json({ error: 'This match is voided.', code: 'MATCH_VOIDED' });
    if (!['scheduled', 'live', 'abandoned'].includes(m.status)) {
      return res.status(409).json({ error: 'This match is finished. Void it to take it off the table.', code: 'MATCH_FINISHED' });
    }
    const body = (req.body ?? {}) as { decision?: unknown; reason?: unknown; winner_side?: unknown; score?: unknown; at?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'Say why, in a few words.', code: 'REASON_REQUIRED' });
    if (reason.length > REASON_MAX) return res.status(400).json({ error: `A reason is up to ${REASON_MAX} characters.`, code: 'REASON_TOO_LONG' });
    const now = new Date().toISOString();
    const ss = { ...((m.score_summary ?? {}) as Record<string, any>) };
    const slug = normSportSlug((await getSport(String(m.sport_id)))?.slug);
    const names = { A: m.team_a_name ?? 'Team A', B: m.team_b_name ?? 'Team B' };
    const bracket = await isKnockoutBracketMatch(m as never);
    let update: Record<string, unknown>;

    if (body.decision === 'replay') {
      if (m.status === 'scheduled') return res.status(409).json({ error: 'This match hasn’t been played yet.', code: 'NOT_STARTED' });
      const at = typeof body.at === 'string' && Number.isFinite(Date.parse(body.at)) ? new Date(body.at).toISOString() : null;
      ss.decision = { kind: 'replay', reason, by: userId, at: now };
      update = { status: 'scheduled', winner_team_id: null, result_type: null, score_summary: ss, ...(at ? { scheduled_at: at } : {}), called_at: null };
    } else if (body.decision === 'stands') {
      const sc = scoreNow(ss);
      if (!sc) return res.status(409).json({ error: 'There’s no score to stand. Award it or replay it instead.', code: 'NO_SCORE' });
      const winner = sc.A > sc.B ? 'A' : sc.B > sc.A ? 'B' : null;
      if (!winner && bracket) return res.status(409).json({ error: 'A knockout match can’t end level — award it or replay it.', code: 'LEVEL_KNOCKOUT' });
      ss.decision = { kind: 'stands', reason, by: userId, at: now };
      ss.result = winner ? `${names[winner]} won ${Math.max(sc.A, sc.B)}–${Math.min(sc.A, sc.B)} (result stands)` : `Draw ${sc.A}–${sc.B} (result stands)`;
      update = { status: 'completed', winner_team_id: winner ? (winner === 'A' ? m.team_a_id : m.team_b_id) : null, result_type: winner ? 'decisive' : 'draw', score_summary: ss, completed_at: now };
    } else if (body.decision === 'awarded') {
      const side = body.winner_side === 'A' || body.winner_side === 'B' ? body.winner_side : null;
      if (!side) return res.status(400).json({ error: 'Say which side it’s awarded to.', code: 'WINNER_REQUIRED' });
      const sc = body.score as { A?: unknown; B?: unknown } | undefined;
      let summary: Record<string, any> = ss;
      if (sc && (sc.A != null || sc.B != null)) {
        const a = num(sc.A); const b = num(sc.B);
        if (a == null || b == null || a < 0 || b < 0 || !Number.isInteger(a) || !Number.isInteger(b)) return res.status(400).json({ error: 'A score is two whole numbers.', code: 'BAD_SCORE' });
        if ((side === 'A' ? a <= b : b <= a)) return res.status(400).json({ error: 'The side it’s awarded to must have the higher score.', code: 'BAD_SCORE' });
        summary = { ...ss, A: { ...(ss.A ?? {}), score: a }, B: { ...(ss.B ?? {}), score: b }, team_a_score: a, team_b_score: b };
      } else {
        // The sport's walkover score (football 3–0 by its rules or the tournament's), when it has one.
        summary = withWalkoverScore(slug, rulesOf(slug, m as never), ss, side, await tournamentSettingsOf(m.tournament_id ?? null));
      }
      const fin = scoreNow(summary);
      summary.decision = { kind: 'awarded', reason, by: userId, at: now };
      summary.result = `${names[side]} awarded the match${fin ? ` ${Math.max(fin.A, fin.B)}–${Math.min(fin.A, fin.B)}` : ''}`;
      update = { status: 'completed', winner_team_id: side === 'A' ? m.team_a_id : m.team_b_id, result_type: 'awarded', score_summary: summary, completed_at: now };
    } else {
      return res.status(400).json({ error: 'Decide: the result stands, replay the rest, or award it.', code: 'BAD_DECISION' });
    }

    // A knockout's next round mustn't have started.
    if (bracket && m.next_match_id && body.decision !== 'replay') {
      const { data: child } = await supabase.from('matches').select('status').eq('id', m.next_match_id).maybeSingle();
      if (child && (child as { status: string }).status !== 'scheduled') return res.status(409).json({ error: 'The next round has already started — resolve it there instead.' });
    }
    const { data: updated, error } = await supabase.from('matches').update({ ...update, updated_at: now }).eq('id', id).select('*').single();
    if (error) return res.status(500).json({ error: 'Couldn’t save the decision.' });
    if (m.tournament_id && body.decision !== 'replay') {
      try { await advanceTournamentWinner(id); } catch { /* the table still reads it */ }
    }
    try {
      const audience = await matchAudienceIds(id, m.team_a_id, m.team_b_id);
      const said = body.decision === 'replay' ? 'will be replayed from where it stopped' : body.decision === 'stands' ? 'result stands' : `awarded to ${names[(body.winner_side as 'A' | 'B')]}`;
      await notifyUsers(audience, { type: 'match_decided', title: `${names.A} vs ${names.B}`, body: `The match ${said} — ${reason}`, data: { matchId: id, screen: 'MatchDetail' } }, { actorId: userId });
    } catch { /* best-effort */ }
    return res.json({ match: updated });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
