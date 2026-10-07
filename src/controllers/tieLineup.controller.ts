/**
 * Badminton 7.16 (Oct 2026) · a team tie's order: each side's captain names who
 * plays each rubber (S1 D1 S2 D2 S3) before the tie. As in BWF team events the
 * orders are exchanged together — a side's order stays hidden from the other
 * side until both are in (the organiser and umpire see both). It locks when the
 * tie starts. A player plays at most one singles and one doubles; the two
 * doubles pairs differ. Stored on match_participants (role "tie:S1,D2"), so
 * the scoring pad and the stats read the players as for any match.
 *
 * Stage 9 · T3: any tie sport and the organiser's own list (tieCore) — each
 * match's key, name and singles/doubles from the tie; "a player plays one
 * singles and one doubles at most" unless the tie lets players repeat; a
 * match for pairs "90+" checks the pair's combined age.
 */
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { isTeamManager } from '../utils/teamAuth';
import { getSport } from '../utils/sportCache';
import { rubberPlayers, tieSpecOf, type MatchRules } from '../utils/matchRules';
import type { TieSpec } from '../utils/tieCore';
import { ageOn } from '../utils/tournamentSettings';
import { notifyUsers } from '../utils/notify';

type Side = 'A' | 'B';
type Lineup = Record<string, string[]>;
const TIE = 'tie:';

/** "tie:S1,D2" → ['S1','D2']. */
export const rubbersOfRole = (role: string | null | undefined): string[] => (role && role.startsWith(TIE) ? role.slice(TIE.length).split(',').filter(Boolean) : []);

/** Pure: what's wrong with an order, or null. `members` = the side's team. (A standard order: S1, D1, …) */
export function tieLineupProblem(order: string[], lineup: unknown, members: Set<string>): string | null {
  return tieSpecLineupProblem({ rubbers: order.map((k) => ({ key: k, label: k, players: rubberPlayers(k) })), win: 'first' }, lineup, members);
}

/** Stage 9 · T3 · the same for any tie: each match by its key, named by its label. */
export function tieSpecLineupProblem(spec: TieSpec, lineup: unknown, members: Set<string>): string | null {
  if (!lineup || typeof lineup !== 'object' || Array.isArray(lineup)) return 'Name who plays each rubber.';
  const l = lineup as Record<string, unknown>;
  const keys = spec.rubbers.map((r) => r.key);
  const extra = Object.keys(l).find((k) => !keys.includes(k));
  if (extra) return `This tie has no rubber “${extra}”.`;
  const count = new Map<string, { s: number; d: number }>();
  for (const r of spec.rubbers) {
    const ids = l[r.key];
    const need = r.players;
    if (!Array.isArray(ids) || ids.length !== need || ids.some((x) => typeof x !== 'string')) return `${r.label} needs ${need === 1 ? 'a player' : 'two players'}.`;
    if (new Set(ids).size !== ids.length) return `${r.label} needs two different players.`;
    for (const u of ids as string[]) {
      if (!members.has(u)) return `Everyone in the order has to be in the team (${r.label}).`;
      const c = count.get(u) ?? { s: 0, d: 0 };
      if (need === 1) c.s++; else c.d++;
      count.set(u, c);
      if (!spec.repeatPlayers && c.s > 1) return 'A player plays one singles at most.';
      if (!spec.repeatPlayers && c.d > 1) return 'A player plays one doubles at most.';
    }
  }
  return null;
}

async function load(id: string) {
  const { data: m } = await supabase.from('matches')
    .select('id, sport_id, tournament_id, status, rules, team_a_id, team_b_id, team_a_name, team_b_name, umpire_id')
    .eq('id', id).maybeSingle();
  if (!m) return null;
  const row = m as { id: string; sport_id: string; tournament_id: string | null; status: string; rules: Partial<MatchRules> | null; team_a_id: string | null; team_b_id: string | null; team_a_name: string | null; team_b_name: string | null; umpire_id: string | null };
  const slug = (await getSport(row.sport_id))?.slug ?? null;
  const spec = tieSpecOf(slug, row.rules);
  return { m: row, spec, order: spec ? spec.rubbers.map((r) => r.key) : null };
}

async function lineupsOf(matchId: string): Promise<Record<Side, Lineup | null>> {
  const { data } = await supabase.from('match_participants').select('user_id, team_side, role').eq('match_id', matchId);
  const out: Record<Side, Lineup | null> = { A: null, B: null };
  for (const p of (data ?? []) as Array<{ user_id: string; team_side: Side | null; role: string | null }>) {
    if (!p.team_side) continue;
    for (const r of rubbersOfRole(p.role)) {
      const l = (out[p.team_side] ??= {});
      (l[r] ??= []).push(p.user_id);
    }
  }
  return out;
}

const complete = (spec: TieSpec, l: Lineup | null) => !!l && spec.rubbers.every((r) => (l[r.key]?.length ?? 0) === r.players);

// GET /matches/:id/tie-lineup
export async function getTieLineup(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Match not found' });
    const got = await load(id);
    if (!got) return res.status(404).json({ error: 'Match not found' });
    const { m, order, spec } = got;
    if (!order || !spec) return res.status(400).json({ error: 'This match isn’t a team tie with an order.', code: 'NOT_A_TIE' });
    const official = m.umpire_id === userId || (!!m.tournament_id && (await isTournamentOrganiser(m.tournament_id, userId)));
    const can: Record<Side, boolean> = {
      A: official || (await isTeamManager(m.team_a_id, userId)),
      B: official || (await isTeamManager(m.team_b_id, userId)),
    };
    const ups = await lineupsOf(id);
    const inA = complete(spec, ups.A); const inB = complete(spec, ups.B);
    const open = m.status !== 'scheduled' || (inA && inB);
    const seeA = official || can.A || open; const seeB = official || can.B || open;
    const ids = [...new Set([...(seeA ? Object.values(ups.A ?? {}).flat() : []), ...(seeB ? Object.values(ups.B ?? {}).flat() : [])])];
    // The team lists for the sides this user sets.
    const members: Record<Side, Array<{ id: string; name: string }>> = { A: [], B: [] };
    const teamOf: Record<Side, string | null> = { A: m.team_a_id, B: m.team_b_id };
    const memIds: Record<Side, string[]> = { A: [], B: [] };
    for (const s of ['A', 'B'] as Side[]) {
      if (!can[s] || !teamOf[s] || m.status !== 'scheduled') continue;
      const { data } = await supabase.from('team_members').select('user_id').eq('team_id', teamOf[s]!);
      memIds[s] = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
    }
    const all = [...new Set([...ids, ...memIds.A, ...memIds.B])];
    const { data: us } = all.length ? await supabase.from('users').select('id, name, username').in('id', all) : { data: [] };
    const nameOf = new Map(((us ?? []) as Array<{ id: string; name: string | null; username: string | null }>).map((u) => [u.id, u.name || u.username || 'Player']));
    for (const s of ['A', 'B'] as Side[]) members[s] = memIds[s].map((u) => ({ id: u, name: nameOf.get(u) ?? 'Player' }));
    const named = (l: Lineup | null) => (l ? Object.fromEntries(order.map((r) => [r, (l[r] ?? []).map((u) => ({ id: u, name: nameOf.get(u) ?? 'Player' }))])) : null);
    return res.json({
      order,
      // Stage 9 · T3: each match's name, singles/doubles and any combined age.
      rubbers: spec.rubbers,
      repeat_players: spec.repeatPlayers === true,
      locked: m.status !== 'scheduled',
      sides: {
        A: { name: m.team_a_name, submitted: inA, can_set: can.A && m.status === 'scheduled', lineup: seeA ? named(ups.A) : null, members: members.A },
        B: { name: m.team_b_name, submitted: inB, can_set: can.B && m.status === 'scheduled', lineup: seeB ? named(ups.B) : null, members: members.B },
      },
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PUT /matches/:id/tie-lineup  { side: 'A'|'B', lineup: { S1: [id], D1: [id, id], … } }
export async function setTieLineup(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Match not found' });
    const side = req.body?.side as Side;
    if (side !== 'A' && side !== 'B') return res.status(400).json({ error: 'Say which side this order is for.', code: 'BAD_SIDE' });
    const got = await load(id);
    if (!got) return res.status(404).json({ error: 'Match not found' });
    const { m, order, spec } = got;
    if (!order || !spec) return res.status(400).json({ error: 'This match isn’t a team tie with an order.', code: 'NOT_A_TIE' });
    const teamId = side === 'A' ? m.team_a_id : m.team_b_id;
    if (!teamId) return res.status(409).json({ error: 'This side isn’t known yet.', code: 'SIDES_UNKNOWN' });
    const official = m.umpire_id === userId || (!!m.tournament_id && (await isTournamentOrganiser(m.tournament_id, userId)));
    if (!official && !(await isTeamManager(teamId, userId))) return res.status(403).json({ error: 'Only this side’s captain (or the organiser) gives its order.' });
    if (m.status !== 'scheduled') return res.status(409).json({ error: 'The tie has started, so the order is fixed.', code: 'LINEUP_LOCKED' });
    const { data: mem } = await supabase.from('team_members').select('user_id').eq('team_id', teamId);
    const members = new Set(((mem ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
    const lineup = req.body?.lineup as Lineup;
    const bad = tieSpecLineupProblem(spec, lineup, members);
    if (bad) return res.status(400).json({ error: bad, code: 'BAD_LINEUP' });
    // Stage 9 · T3: a match for pairs "90+" — the pair's combined age today.
    const aged = spec.rubbers.filter((r) => r.pairAgeMin != null);
    if (aged.length) {
      const ids = [...new Set(aged.flatMap((r) => lineup[r.key] ?? []))];
      const { data: us } = await supabase.from('users').select('id, name, username, dob').in('id', ids);
      const user = new Map(((us ?? []) as Array<{ id: string; name: string | null; username: string | null; dob: string | null }>).map((u) => [u.id, u]));
      for (const r of aged) {
        const pair = (lineup[r.key] ?? []).map((u) => user.get(u));
        const ages = pair.map((u) => (u?.dob ? ageOn(u.dob, new Date()) : null));
        const nm = (i: number) => pair[i]?.name || pair[i]?.username || 'A player';
        const missing = ages.findIndex((a) => a == null);
        if (missing >= 0) return res.status(400).json({ error: `${nm(missing)}’s profile doesn’t list their date of birth, and ${r.label} is for pairs ${r.pairAgeMin}+ combined.`, code: 'PAIR_AGE' });
        const sum = (ages[0] as number) + (ages[1] as number);
        if (sum < (r.pairAgeMin as number)) return res.status(400).json({ error: `${r.label} is for pairs ${r.pairAgeMin}+ combined, and ${nm(0)} and ${nm(1)} add up to ${sum}.`, code: 'PAIR_AGE' });
      }
    }
    const before = await lineupsOf(id);
    const otherWasIn = complete(spec, before[side === 'A' ? 'B' : 'A']);
    const wasIn = complete(spec, before[side]);
    // This side's players, each with their rubbers.
    const roles = new Map<string, string[]>();
    for (const r of order) for (const u of lineup[r]!) roles.set(u, [...(roles.get(u) ?? []), r]);
    await supabase.from('match_participants').delete().eq('match_id', id).eq('team_side', side);
    const { error } = await supabase.from('match_participants').insert([...roles].map(([u, rs]) => ({ match_id: id, user_id: u, team_side: side, role: `${TIE}${rs.join(',')}` })));
    if (error) return res.status(500).json({ error: 'The order wasn’t saved. Try again.' });
    // Both orders in (for the first time): both sides hear it.
    if (otherWasIn && !wasIn) {
      try {
        const { data: tm } = await supabase.from('team_members').select('user_id').in('team_id', [m.team_a_id, m.team_b_id].filter(Boolean) as string[]);
        const ids = [...new Set(((tm ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))].filter((u) => u !== userId);
        if (ids.length) await notifyUsers(ids, { type: 'tie_lineup', title: 'Both orders are in', body: `${m.team_a_name ?? 'Team A'} vs ${m.team_b_name ?? 'Team B'} — see who plays each rubber.`, data: { matchId: id } }, { actorId: userId });
      } catch { /* best-effort */ }
    }
    return res.json({ ok: true, both_in: otherWasIn });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
