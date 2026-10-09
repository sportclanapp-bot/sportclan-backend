/**
 * Stage 12 · CH5 · board prizes in a team chess event: for each board, every
 * player who played on it — games, points (the board's game points), and the
 * percentage — best first. The Olympiad and AICF team events give medals per
 * board (the Olympiad asks for a minimum number of games: the organiser's
 * choice, `?min=`). Read from each finished match's board results
 * (score_summary.rubbers) and its line-ups (match_participants "tie:B1").
 * GET /tournaments/:id/board-prizes
 */
import type { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { allRows, selectAllIn } from '../utils/selectAll';
import { getSport, normSportSlug } from '../utils/sportCache';
import { tieSpecOf, type MatchRules } from '../utils/matchRules';

type Row = { user_id: string; name: string; team: string; games: number; points: number };

export async function getBoardPrizes(req: Request, res: Response) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const min = Math.max(0, Number(req.query.min ?? 0) || 0);
  const { data: t } = await supabase.from('tournaments').select('id, sport_id, match_rules').eq('id', id).maybeSingle();
  if (!t) return res.status(404).json({ error: 'Tournament not found' });
  const slug = normSportSlug((await getSport(String(t.sport_id)))?.slug);
  const ms = ((await allRows(() => supabase.from('matches').select('id, team_a_id, team_b_id, team_a_name, team_b_name, status, score_summary, rules, voided_at')
    .eq('tournament_id', id).eq('status', 'completed').is('voided_at', null))) ?? []) as Array<{ id: string; team_a_name: string | null; team_b_name: string | null; score_summary: any; rules: unknown }>;
  const ties = ms.filter((m) => slug === 'chess' && tieSpecOf(slug, (m.rules ?? null) as Partial<MatchRules> | null) && Array.isArray(m.score_summary?.rubbers));
  if (!ties.length) return res.json({ boards: [], min });
  const parts = (await selectAllIn(ties.map((m) => m.id), (c, f, to) => supabase.from('match_participants').select('match_id, user_id, team_side, role').in('match_id', c).order('id').range(f, to))) as Array<{ match_id: string; user_id: string; team_side: 'A' | 'B'; role: string | null }>;
  const users = [...new Set(parts.map((p) => p.user_id))];
  const names = new Map(((await selectAllIn(users, (c, f, to) => supabase.from('users').select('id, name').in('id', c).order('id').range(f, to))) as Array<{ id: string; name: string }>).map((u) => [u.id, u.name]));
  const boards = new Map<string, { label: string; order: number; rows: Map<string, Row> }>();
  for (const m of ties) {
    const spec = tieSpecOf(slug, m.rules as Partial<MatchRules>)!;
    (m.score_summary.rubbers as Array<{ key: string; label?: string; unitsA?: number; unitsB?: number }>).forEach((r) => {
      const idx = spec.rubbers.findIndex((x) => x.key === r.key);
      const b = boards.get(r.key) ?? boards.set(r.key, { label: r.label ?? spec.rubbers[idx]?.label ?? r.key, order: idx < 0 ? 999 : idx, rows: new Map() }).get(r.key)!;
      for (const side of ['A', 'B'] as const) {
        const who = parts.find((p) => p.match_id === m.id && p.team_side === side && (p.role ?? '').startsWith('tie:') && p.role!.slice(4).split(',').includes(r.key));
        if (!who) continue;
        const row = b.rows.get(who.user_id) ?? b.rows.set(who.user_id, { user_id: who.user_id, name: names.get(who.user_id) ?? 'Player', team: (side === 'A' ? m.team_a_name : m.team_b_name) ?? 'Team', games: 0, points: 0 }).get(who.user_id)!;
        row.games += 1;
        row.points += Number(side === 'A' ? r.unitsA ?? 0 : r.unitsB ?? 0);
      }
    });
  }
  const winPts = (() => { const s = tieSpecOf(slug, (ties[0]!.rules ?? null) as Partial<MatchRules>); return s?.boardPoints?.winBlack ?? s?.boardPoints?.win ?? 1; })();
  const out = [...boards.values()].sort((x, y) => x.order - y.order).map((b) => ({
    board: b.label,
    players: [...b.rows.values()].map((r) => ({ ...r, pct: r.games ? Math.round((r.points / (r.games * winPts)) * 1000) / 10 : 0, eligible: r.games >= min }))
      .sort((x, y) => Number(y.eligible) - Number(x.eligible) || y.pct - x.pct || y.points - x.points || y.games - x.games || x.name.localeCompare(y.name)),
  }));
  return res.json({ boards: out, min });
}
