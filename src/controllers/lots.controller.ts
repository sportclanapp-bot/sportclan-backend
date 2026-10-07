/**
 * Stage 8 · F8 (Oct 2026) · a draw of lots: teams level on every tie-break are
 * placed in the order the organiser drew (FIFA's last resort, older UEFA and
 * AIFF rules). PUT /tournaments/:id/lots { group: 'A' | null, order: [teamId…] }
 * — the teams of that group (or the one table) in the drawn order; an empty
 * order clears it. Stored on settings.lots; the tables, the champion and the
 * knockout seeding all read it.
 */
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { allRows } from '../utils/selectAll';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { settingsOf, storedSettings } from '../utils/tournamentSettings';

export async function setLots(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const { data: t } = await supabase.from('tournaments').select('id, settings').eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(id, userId))) return res.status(403).json({ error: 'Only the organiser can record a draw of lots.' });
    const body = (req.body ?? {}) as { group?: unknown; order?: unknown };
    const group = typeof body.group === 'string' && body.group.trim() ? body.group.trim() : '';
    const order = Array.isArray(body.order) ? body.order : null;
    if (!order || order.some((x) => typeof x !== 'string') || new Set(order).size !== order.length) {
      return res.status(400).json({ error: 'Send the teams in the order drawn, each once.', code: 'BAD_LOTS' });
    }
    if (order.length) {
      const entries = await allRows(() => supabase.from('tournament_entries').select('team_id, group_label, status').eq('tournament_id', id).in('status', ['approved', 'withdrawn']));
      const inGroup = new Set(((entries ?? []) as Array<{ team_id: string; group_label: string | null }>).filter((e) => (e.group_label ?? '') === group || !group).map((e) => e.team_id));
      if (order.some((x) => !inGroup.has(x as string))) return res.status(400).json({ error: group ? `Every team must be in group ${group}.` : 'Every team must be in this tournament.', code: 'BAD_LOTS' });
    }
    const cur = settingsOf(t as { settings?: unknown });
    const lots = { ...(cur.lots ?? {}) };
    if (order.length) lots[group] = order as string[]; else delete lots[group];
    const next = storedSettings({ lots: Object.keys(lots).length ? lots : null }, cur);
    const { error } = await supabase.from('tournaments').update({ settings: next }).eq('id', id);
    if (error) return res.status(500).json({ error: 'Couldn’t save the draw of lots.' });
    return res.json({ lots: next.lots ?? {} });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
