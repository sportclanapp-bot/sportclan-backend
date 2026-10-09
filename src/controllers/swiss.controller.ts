/**
 * Stage 12 · CH2 · running a Swiss the FIDE way, for the organiser, the chief
 * arbiter and deputy, and the pairings arbiter:
 *   GET  /tournaments/:id/swiss          the rounds, a draft waiting to be published (with warnings), byes asked for
 *   PUT  /tournaments/:id/swiss/byes     { team_id, round, kind: 'half' | 'zero' | 'absent' | null }
 *   POST /tournaments/:id/swiss/swap     { round, a, b } — swap two players (same board: swap colours)
 *   POST /tournaments/:id/swiss/publish  publish the draft round
 * A swap works on a draft, or on a published round before any of its games has
 * started; the server says what a swap breaks (a repeat, a colour run, the same
 * club in the last round) but lets the arbiter decide.
 */
import type { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { settingsOf } from '../utils/tournamentSettings';
import { colourPreference, dutchHistory } from '../utils/swissDutch';
import { computeStats } from '../utils/standings';
import { swissContext, swissInsertRound, swissPairRound, type SwissByeKind } from './tournaments.controller';
import { fillEntryLineups } from '../utils/entryLineups';

type Ctx = NonNullable<Awaited<ReturnType<typeof swissContext>>>;

async function canManagePairings(tournamentId: string, userId: string): Promise<boolean> {
  if (await isTournamentOrganiser(tournamentId, userId)) return true;
  const { data } = await supabase.from('tournament_officials').select('id').eq('tournament_id', tournamentId).eq('user_id', userId)
    .in('role', ['pairings', 'chief_referee', 'deputy_referee']).limit(1);
  return (data ?? []).length > 0;
}

/** What a round's pairing breaks, in words (repeats; in chess colour runs and differences; same club in the last round). */
function warningsFor(ctx: Ctx, round: number, pairs: Array<{ white: string; black: string }>): string[] {
  const out: string[] = [];
  const name = (id: string) => ctx.nameOf.get(id) ?? 'Player';
  const before = ctx.ms.filter((m) => Number(m.round ?? 0) < round);
  const history = dutchHistory(ctx.ids, before.map((m) => ({
    round: Number(m.round ?? 0), white: m.team_a_id, black: m.team_b_id, bye: m.score_summary?.bye === true,
    byeKind: m.score_summary?.bye_kind ?? null, forfeit: m.score_summary?.walkover === true, winner: m.winner_team_id,
  })), () => 0);
  const lastRound = round === ctx.sw.rounds;
  for (const p of pairs) {
    if (history.get(p.white)?.opponents.has(p.black)) {
      const r = before.find((m) => (m.team_a_id === p.white && m.team_b_id === p.black) || (m.team_a_id === p.black && m.team_b_id === p.white))?.round;
      out.push(`${name(p.white)} and ${name(p.black)} have met before${r ? ` (round ${r})` : ''}.`);
    }
    if (ctx.colours) {
      for (const [id, got] of [[p.white, 'w'], [p.black, 'b']] as const) {
        const cs = [...(history.get(id)?.colours ?? []), got];
        const diff = cs.filter((c) => c === 'w').length - cs.filter((c) => c === 'b').length;
        if (cs.length >= 3 && cs.slice(-3).every((c) => c === got)) out.push(`${name(id)} would have ${got === 'w' ? 'White' : 'Black'} a third time running.`);
        else if (Math.abs(diff) > 2) out.push(`${name(id)} would have ${Math.abs(diff)} more games with ${diff > 0 ? 'White' : 'Black'}.`);
        void colourPreference;
      }
    }
    if (lastRound && ctx.settings.separateClubs) {
      const c = ctx.clubOf(p.white);
      if (c && c === ctx.clubOf(p.black)) out.push(`${name(p.white)} and ${name(p.black)} are both from ${c} (the last round keeps them apart).`);
    }
  }
  return out;
}

const named = (ctx: Ctx, pairs: Array<{ white: string; black: string }>) => pairs.map((p, i) => ({ board: i + 1, white: { id: p.white, name: ctx.nameOf.get(p.white) ?? 'Player' }, black: { id: p.black, name: ctx.nameOf.get(p.black) ?? 'Player' } }));

/** GET /tournaments/:id/swiss */
export async function getSwiss(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const ctx = await swissContext(id);
  if (!ctx) return res.status(404).json({ error: 'This isn’t a Swiss tournament.', code: 'NOT_SWISS' });
  const can = await canManagePairings(id, userId);
  const sw = ctx.sw;
  const base = { rounds: sw.rounds, paired: sw.paired ?? 0, check: sw.check === true, late_entry: sw.lateEntry ?? 'zero', colours: ctx.colours, can_manage: can };
  if (!can) return res.json(base);
  const pts = computeStats(ctx.ids, ctx.ms as never[], undefined, ctx.pts);
  const requests = Object.entries(sw.requests ?? {}).flatMap(([team, byRound]) => Object.entries(byRound).map(([round, kind]) => ({ team_id: team, name: ctx.nameOf.get(team) ?? 'Player', round: Number(round), kind })))
    .sort((x, y) => x.round - y.round || x.name.localeCompare(y.name));
  const draft = sw.draft ? {
    round: sw.draft.round,
    boards: named(ctx, sw.draft.pairs).map((b) => ({ ...b, white: { ...b.white, points: pts.get(b.white.id)?.points ?? 0 }, black: { ...b.black, points: pts.get(b.black.id)?.points ?? 0 } })),
    bye: sw.draft.bye ? { id: sw.draft.bye, name: ctx.nameOf.get(sw.draft.bye) ?? 'Player' } : null,
    warnings: warningsFor(ctx, sw.draft.round, sw.draft.pairs),
  } : null;
  // The latest published round, and whether it can still be swapped (no game started).
  const paired = sw.paired ?? 0;
  const cur = ctx.ms.filter((m) => Number(m.round ?? 0) === paired && m.team_a_id && m.team_b_id);
  const curBye = ctx.ms.find((m) => Number(m.round ?? 0) === paired && m.team_a_id && !m.team_b_id && m.score_summary?.bye === true && !m.score_summary?.bye_kind);
  const swappable = paired >= 1 && cur.length > 0 && cur.every((m) => m.status === 'scheduled');
  return res.json({
    ...base, requests, draft,
    players: ctx.ids.map((tid) => ({ id: tid, name: ctx.nameOf.get(tid) ?? 'Player', points: pts.get(tid)?.points ?? 0 })),
    current: paired >= 1 ? {
      round: paired, swappable,
      boards: named(ctx, cur.map((m) => ({ white: m.team_a_id!, black: m.team_b_id! }))),
      bye: curBye?.team_a_id ? { id: curBye.team_a_id, name: ctx.nameOf.get(curBye.team_a_id) ?? 'Player' } : null,
      warnings: swappable ? warningsFor(ctx, paired, cur.map((m) => ({ white: m.team_a_id!, black: m.team_b_id! }))) : [],
    } : null,
  });
}

/** PUT /tournaments/:id/swiss/byes */
export async function setSwissBye(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  if (!(await canManagePairings(id, userId))) return res.status(403).json({ error: 'Only the organiser or an arbiter can record a bye.' });
  const ctx = await swissContext(id);
  if (!ctx) return res.status(404).json({ error: 'This isn’t a Swiss tournament.', code: 'NOT_SWISS' });
  const { team_id, round, kind } = (req.body ?? {}) as { team_id?: unknown; round?: unknown; kind?: unknown };
  if (typeof team_id !== 'string' || !ctx.ids.includes(team_id)) return res.status(400).json({ error: 'Pick a player in this tournament.', code: 'BAD_PLAYER' });
  const r = Number(round);
  const paired = ctx.sw.paired ?? 0;
  const draftRound = ctx.sw.draft?.round ?? null;
  if (!Number.isInteger(r) || r < 1 || r > ctx.sw.rounds) return res.status(400).json({ error: `A round is 1 to ${ctx.sw.rounds}.`, code: 'BAD_ROUND' });
  if (r <= paired) return res.status(409).json({ error: `Round ${r} is already paired.`, code: 'ROUND_PAIRED' });
  if (kind != null && kind !== 'half' && kind !== 'zero' && kind !== 'absent') return res.status(400).json({ error: 'A bye is half a point, none, or absent.', code: 'BAD_BYE' });
  const reqs = { ...(ctx.sw.requests ?? {}) };
  const mine = { ...(reqs[team_id] ?? {}) };
  if (kind == null) delete mine[String(r)]; else mine[String(r)] = kind as SwissByeKind;
  if (Object.keys(mine).length) reqs[team_id] = mine; else delete reqs[team_id];
  let sw = { ...ctx.sw, requests: reqs };
  // A draft of that round is paired again with the change.
  if (draftRound === r) {
    const again = swissPairRound({ ...ctx, sw }, r);
    sw = { ...sw, draft: { round: r, pairs: again.round.pairs, bye: again.round.bye } };
  }
  await supabase.from('tournaments').update({ settings: { ...ctx.settings, swiss: sw }, updated_at: new Date().toISOString() }).eq('id', id);
  return res.json({ ok: true, requests: reqs, redrafted: draftRound === r });
}

/** POST /tournaments/:id/swiss/swap */
export async function swapSwissPairing(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  if (!(await canManagePairings(id, userId))) return res.status(403).json({ error: 'Only the organiser or an arbiter can change pairings.' });
  const ctx = await swissContext(id);
  if (!ctx) return res.status(404).json({ error: 'This isn’t a Swiss tournament.', code: 'NOT_SWISS' });
  const { round, a, b } = (req.body ?? {}) as { round?: unknown; a?: unknown; b?: unknown };
  const r = Number(round);
  if (typeof a !== 'string' || typeof b !== 'string' || !ctx.ids.includes(a) || !ctx.ids.includes(b)) return res.status(400).json({ error: 'Pick two players.', code: 'BAD_PLAYER' });
  const swapIn = (pairs: Array<{ white: string; black: string }>, bye: string | null) => {
    const sameBoard = pairs.find((p) => (p.white === a && p.black === b) || (p.white === b && p.black === a));
    if (sameBoard) return { pairs: pairs.map((p) => (p === sameBoard ? { white: p.black, black: p.white } : p)), bye };
    const sw = (x: string) => (x === a ? b : x === b ? a : x);
    return { pairs: pairs.map((p) => ({ white: sw(p.white), black: sw(p.black) })), bye: bye ? sw(bye) : bye };
  };
  if (ctx.sw.draft && ctx.sw.draft.round === r) {
    const next = swapIn(ctx.sw.draft.pairs, ctx.sw.draft.bye);
    const inRound = [...next.pairs.flatMap((p) => [p.white, p.black]), ...(next.bye ? [next.bye] : [])];
    if (!inRound.includes(a) || !inRound.includes(b)) return res.status(400).json({ error: 'Both players must be in this round’s pairings.', code: 'NOT_IN_ROUND' });
    await supabase.from('tournaments').update({ settings: { ...ctx.settings, swiss: { ...ctx.sw, draft: { round: r, ...next } } }, updated_at: new Date().toISOString() }).eq('id', id);
    return res.json({ ok: true, warnings: warningsFor(ctx, r, next.pairs) });
  }
  // A published round: only the latest, and only before any of its games has started.
  if (r !== (ctx.sw.paired ?? 0)) return res.status(409).json({ error: 'Only the latest round can change, before its games start.', code: 'ROUND_FIXED' });
  const rows = ctx.ms.filter((m) => Number(m.round ?? 0) === r && m.team_a_id && (m.team_b_id || (m.score_summary?.bye === true && !m.score_summary?.bye_kind)));
  if (rows.some((m) => m.team_b_id && m.status !== 'scheduled')) return res.status(409).json({ error: 'A game of this round has started, so its pairings are fixed.', code: 'ROUND_STARTED' });
  const games = rows.filter((m) => m.team_b_id).map((m) => ({ row: m, white: m.team_a_id!, black: m.team_b_id! }));
  const byeRow = rows.find((m) => !m.team_b_id) ?? null;
  const next = swapIn(games.map((g) => ({ white: g.white, black: g.black })), byeRow?.team_a_id ?? null);
  const inRound = [...next.pairs.flatMap((p) => [p.white, p.black]), ...(next.bye ? [next.bye] : [])];
  if (!inRound.includes(a) || !inRound.includes(b)) return res.status(400).json({ error: 'Both players must be in this round’s pairings.', code: 'NOT_IN_ROUND' });
  const name = (x: string) => ctx.nameOf.get(x) ?? 'Player';
  for (let i = 0; i < games.length; i++) {
    const g = games[i]!; const p = next.pairs[i]!;
    if (g.white === p.white && g.black === p.black) continue;
    await supabase.from('matches').update({ team_a_id: p.white, team_b_id: p.black, team_a_name: name(p.white), team_b_name: name(p.black) }).eq('id', g.row.id);
    // The game's line-up was its old players': cleared, then filled from the new entries.
    await supabase.from('match_participants').delete().eq('match_id', g.row.id);
  }
  await fillEntryLineups(id);
  if (byeRow && next.bye && byeRow.team_a_id !== next.bye) {
    await supabase.from('matches').update({ team_a_id: next.bye, team_a_name: name(next.bye), winner_team_id: next.bye, score_summary: { ...byeRow.score_summary, result: `${name(next.bye)} has a bye (a win)` } }).eq('id', byeRow.id);
  }
  return res.json({ ok: true, warnings: warningsFor(ctx, r, next.pairs) });
}

/** POST /tournaments/:id/swiss/publish */
export async function publishSwissRound(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  if (!(await canManagePairings(id, userId))) return res.status(403).json({ error: 'Only the organiser or an arbiter can publish a round.' });
  const ctx = await swissContext(id);
  if (!ctx) return res.status(404).json({ error: 'This isn’t a Swiss tournament.', code: 'NOT_SWISS' });
  const draft = ctx.sw.draft;
  if (!draft) return res.status(409).json({ error: 'There’s no round waiting to be published.', code: 'NO_DRAFT' });
  // Claim it: the draft goes, the round is paired.
  const { draft: _gone, ...rest } = ctx.sw;
  void _gone;
  const { data: claim } = await supabase.from('tournaments')
    .update({ settings: { ...settingsOf(ctx.t as { settings?: unknown }), swiss: { ...rest, paired: draft.round } }, updated_at: new Date().toISOString() })
    .eq('id', id).eq('settings->swiss->draft->>round', String(draft.round)).select('id');
  if (!claim || claim.length === 0) return res.status(409).json({ error: 'That round was just published.', code: 'ALREADY_PUBLISHED' });
  const extras = swissPairRound(ctx, draft.round);
  await swissInsertRound(ctx, draft.round, { ...extras, round: { pairs: draft.pairs, bye: draft.bye } });
  await fillEntryLineups(id); // as after an automatic round
  return res.json({ ok: true, round: draft.round });
}
