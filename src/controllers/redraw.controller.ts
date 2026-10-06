/**
 * Badminton 7.13 (Oct 2026) · re-draw: until a match has started, the organiser
 * can clear the draw and make it again (a late entry, a withdrawal, a wrong
 * seed). The fixtures are deleted — none has a score — and the tournament is
 * ready for "Generate fixtures" again; everyone entered is told. A knockout's
 * bye, or a Swiss bye, doesn't count as started. Sport-neutral.
 */
import { allRows, selectAllIn } from '../utils/selectAll';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { notifyUsers } from '../utils/notify';
import { refreshParentOf } from '../utils/tournamentEvents';

type M = { id: string; status: string; team_a_id: string | null; team_b_id: string | null; team_a_name: string | null; team_b_name: string | null; score_summary: unknown; voided_at: string | null };

/** A bye: one side only, decided without being played. */
export function isBye(m: M): boolean {
  return (!!m.team_a_id !== !!m.team_b_id) && (m.team_a_name === 'BYE' || m.team_b_name === 'BYE' || m.status === 'completed');
}

/** Pure: has any match been played or begun? (A bye hasn't.) */
export function drawStarted(matches: M[]): boolean {
  return matches.some((m) => !isBye(m) && (m.status !== 'scheduled' || (m.score_summary != null && JSON.stringify(m.score_summary) !== '{}') || !!m.voided_at));
}

// POST /tournaments/:id/redraw
export async function redraw(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const { data: t } = await supabase.from('tournaments').select('id, name, status, fixtures_generated, is_parent, parent_id, settings').eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const row = t as { id: string; name: string | null; status: string; fixtures_generated: boolean | null; is_parent?: boolean | null; parent_id?: string | null; settings?: Record<string, unknown> | null };
    if (!(await isTournamentOrganiser(id, userId))) return res.status(403).json({ error: 'Only the organiser can make the draw again.' });
    if (row.is_parent) return res.status(400).json({ error: 'Each event has its own draw — make it again on the event.', code: 'REDRAW_AN_EVENT' });
    if (row.status === 'completed' || row.status === 'cancelled') return res.status(409).json({ error: 'This tournament is over.', code: 'TOURNAMENT_OVER' });
    if (!row.fixtures_generated) return res.status(409).json({ error: 'There’s no draw yet.', code: 'NOT_DRAWN' });
    const ms = await allRows(() => supabase.from('matches')
      .select('id, status, team_a_id, team_b_id, team_a_name, team_b_name, score_summary, voided_at')
      .eq('tournament_id', id));
    const matches = (ms ?? []) as M[];
    if (drawStarted(matches)) {
      return res.status(409).json({ error: 'A match has started, so the draw can’t be made again. Edit a fixture instead.', code: 'DRAW_STARTED' });
    }
    if (matches.length) {
      const { error } = await supabase.from('matches').delete().in('id', matches.map((m) => m.id));
      if (error) return res.status(409).json({ error: 'The draw couldn’t be cleared. Edit the fixtures instead.', code: 'REDRAW_FAILED' });
    }
    // Ready for "Generate fixtures": the flag down; a random draw's seeds go (it writes new ones).
    const settings = { ...(row.settings ?? {}) } as Record<string, unknown>;
    const swiss = settings.swiss as { rounds?: number; paired?: number } | undefined;
    if (swiss && swiss.paired) settings.swiss = { ...swiss, paired: 0 };
    await supabase.from('tournaments').update({ fixtures_generated: false, status: 'upcoming', settings, updated_at: new Date().toISOString() }).eq('id', id);
    if (settings.seeding === 'random') await supabase.from('tournament_entries').update({ seed: null }).eq('tournament_id', id);
    if (row.parent_id) await refreshParentOf(id);
    // Everyone entered hears it once.
    try {
      const ents = await allRows(() => supabase.from('tournament_entries').select('team_id').eq('tournament_id', id).eq('status', 'approved'));
      const teamIds = [...new Set(((ents ?? []) as Array<{ team_id: string | null }>).map((e) => e.team_id).filter(Boolean))] as string[];
      if (teamIds.length) {
        const mem = await selectAllIn(teamIds, (c, f, to) => supabase.from('team_members').select('user_id').in('team_id', c).order('id').range(f, to));
        const ids = [...new Set(((mem ?? []) as Array<{ user_id: string }>).map((m) => m.user_id))].filter((u) => u !== userId);
        if (ids.length) {
          await notifyUsers(ids, {
            type: 'tournament_updated', title: 'New draw coming',
            body: `${row.name ?? 'Your tournament'}: the organiser is making the draw again — your matches will change.`,
            data: { tournamentId: id },
          }, { actorId: userId });
        }
      }
    } catch { /* best-effort */ }
    return res.json({ removed: matches.length });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
