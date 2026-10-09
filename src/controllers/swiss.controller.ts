/**
 * Stage 12 · CH2 · running a Swiss the FIDE way, for the organiser, the chief
 * arbiter and deputy, and the pairings arbiter:
 *   GET  /tournaments/:id/swiss          the rounds, a draft waiting to be published (with warnings), byes asked for
 *   PUT  /tournaments/:id/swiss/byes     { team_id, round, kind: 'half' | 'zero' | 'absent' | null }
 *   POST /tournaments/:id/swiss/swap     { round, a, b } — swap two players (same board: swap colours)
 *   POST /tournaments/:id/swiss/publish  publish the draft round
 * Stage 12 follow-up · a player asks for a bye (swiss_bye_requests, migration 139):
 *   GET    /tournaments/:id/swiss/bye-requests/mine         the rounds open to ask, and the player's requests
 *   POST   /tournaments/:id/swiss/bye-requests              { team_id, round, kind } — a player of the entry (a team: its captain)
 *   DELETE /tournaments/:id/swiss/bye-requests/:reqId       withdraw it (before its round is paired)
 *   POST   /tournaments/:id/swiss/bye-requests/:reqId/decide { approve } — the organiser or an arbiter
 * A swap works on a draft, or on a published round before any of its games has
 * started; the server says what a swap breaks (a repeat, a colour run, the same
 * club in the last round) but lets the arbiter decide.
 */
import type { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { byeAskRounds, settingsOf } from '../utils/tournamentSettings';
import { byeWords, entryPlayers, type ByeKind } from '../utils/swissByeRequests';
import { notifyUsers } from '../utils/notify';
import { colourPreference, dutchHistory } from '../utils/swissDutch';
import { computeStats } from '../utils/standings';
import { swissContext, swissInsertRound, swissLateRounds, swissPairRound, type SwissByeKind } from './tournaments.controller';
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
  // A late entrant's missed rounds count as they will once the round is published (the pairing counts them already).
  const pts = computeStats(ctx.ids, [...ctx.ms, ...swissLateRounds(ctx, sw.draft?.round ?? (sw.paired ?? 0) + 1).virtual] as never[], undefined, ctx.pts);
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
  // Stage 12 follow-up: the byes players asked for, waiting for a decision.
  const { data: waiting } = await supabase.from('swiss_bye_requests').select('id, team_id, round, kind, note, created_at').eq('tournament_id', id).eq('status', 'pending').order('round').order('created_at');
  const asked = ((waiting ?? []) as Array<{ id: string; team_id: string; round: number; kind: ByeKind; note: string | null; created_at: string }>)
    .map((w) => ({ ...w, name: ctx.nameOf.get(w.team_id) ?? 'Player', too_late: w.round <= (sw.paired ?? 0) }));
  return res.json({
    ...base, requests, draft, asked, ask_until: sw.askUntil ?? null,
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
  const reqs = await writeBye(ctx, id, team_id, r, (kind ?? null) as SwissByeKind | null);
  // A bye the player asked for, taken off by the organiser: the request says so.
  if (kind == null) await supabase.from('swiss_bye_requests').update({ status: 'declined', note: 'Taken off by the organiser.', decided_by: userId, decided_at: new Date().toISOString() }).eq('tournament_id', id).eq('team_id', team_id).eq('round', r).eq('status', 'approved');
  return res.json({ ok: true, requests: reqs, redrafted: draftRound === r });
}

/** Record (or clear) an entry's bye for a round not yet paired; a draft of that round is paired again. */
async function writeBye(ctx: Ctx, id: string, team: string, r: number, kind: SwissByeKind | null) {
  const reqs = { ...(ctx.sw.requests ?? {}) };
  const mine = { ...(reqs[team] ?? {}) };
  if (kind == null) delete mine[String(r)]; else mine[String(r)] = kind;
  if (Object.keys(mine).length) reqs[team] = mine; else delete reqs[team];
  let sw = { ...ctx.sw, requests: reqs };
  if ((ctx.sw.draft?.round ?? null) === r) {
    const again = swissPairRound({ ...ctx, sw }, r);
    sw = { ...sw, draft: { round: r, pairs: again.round.pairs, bye: again.round.bye } };
  }
  await supabase.from('tournaments').update({ settings: { ...ctx.settings, swiss: sw }, updated_at: new Date().toISOString() }).eq('id', id);
  return reqs;
}

type ByeRequestRow = { id: string; tournament_id: string; team_id: string; round: number; kind: ByeKind; status: string; note: string | null; requested_by: string | null; created_at: string; decided_at: string | null };

/** The people who decide byes: the organiser and the arbiters who pair. */
async function byeDeciders(ctx: Ctx): Promise<string[]> {
  const { data } = await supabase.from('tournament_officials').select('user_id').eq('tournament_id', ctx.t.id as string).in('role', ['pairings', 'chief_referee', 'deputy_referee']);
  return [...new Set([ctx.t.created_by as string, ...((data ?? []) as Array<{ user_id: string }>).map((o) => o.user_id)])];
}

/** The entries in this Swiss the caller may ask for (a singles / doubles entry: its players; a team: its captain or co-captain). */
async function myEntries(ctx: Ctx, userId: string): Promise<string[]> {
  if (!ctx.ids.length) return [];
  const { data } = await supabase.from('team_members').select('team_id, role').eq('user_id', userId).in('team_id', ctx.ids);
  const kind = (ctx.t as { entry_kind?: string | null }).entry_kind ?? 'team';
  return ((data ?? []) as Array<{ team_id: string; role: string }>)
    .filter((m) => kind !== 'team' || m.role === 'captain' || m.role === 'vice_captain').map((m) => m.team_id);
}

/** GET /tournaments/:id/swiss/bye-requests/mine */
export async function myByeRequests(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const ctx = await swissContext(id);
  if (!ctx) return res.status(404).json({ error: 'This isn’t a Swiss tournament.', code: 'NOT_SWISS' });
  const teams = await myEntries(ctx, userId);
  if (!teams.length) return res.json({ entries: [], rounds: [], requests: [] });
  const { data } = await supabase.from('swiss_bye_requests').select('id, team_id, round, kind, status, note, created_at, decided_at').eq('tournament_id', id).in('team_id', teams).order('round');
  const asked = (data ?? []) as ByeRequestRow[];
  // The organiser's own records for these entries show too.
  const recorded = teams.flatMap((t) => Object.entries(ctx.sw.requests?.[t] ?? {})
    .filter(([r]) => !asked.some((a) => a.team_id === t && String(a.round) === r && a.status === 'approved'))
    .map(([r, k]) => ({ id: null, team_id: t, round: Number(r), kind: k, status: 'recorded', note: null })));
  return res.json({
    entries: teams.map((t) => ({ id: t, name: ctx.nameOf.get(t) ?? 'Your entry' })),
    rounds: byeAskRounds(ctx.sw), ask_until: ctx.sw.askUntil ?? null,
    requests: [...asked, ...recorded].sort((a, b) => a.round - b.round),
  });
}

/** POST /tournaments/:id/swiss/bye-requests */
export async function askSwissBye(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const ctx = await swissContext(id);
  if (!ctx) return res.status(404).json({ error: 'This isn’t a Swiss tournament.', code: 'NOT_SWISS' });
  const { team_id, round, kind, note } = (req.body ?? {}) as { team_id?: unknown; round?: unknown; kind?: unknown; note?: unknown };
  const teams = await myEntries(ctx, userId);
  const team = typeof team_id === 'string' ? team_id : teams.length === 1 ? teams[0]! : null;
  if (!team || !teams.includes(team)) return res.status(403).json({ error: 'Only a player in this Swiss (a team: its captain) can ask for a bye.', code: 'NOT_YOUR_ENTRY' });
  if (kind !== 'half' && kind !== 'zero' && kind !== 'absent') return res.status(400).json({ error: 'A bye is half a point, none, or absent.', code: 'BAD_BYE' });
  if (note != null && (typeof note !== 'string' || note.length > 200)) return res.status(400).json({ error: 'A note is up to 200 characters.', code: 'BAD_NOTE' });
  const r = Number(round);
  const open = byeAskRounds(ctx.sw);
  if (!open.includes(r)) {
    const until = ctx.sw.askUntil;
    return res.status(409).json({
      error: until === 0 ? 'The organiser takes bye requests in person for this Swiss.'
        : until != null && r > until ? `Byes can be asked for up to round ${until}.`
          : r <= (ctx.sw.paired ?? 0) ? `Round ${r} is already paired.` : `A round is 1 to ${ctx.sw.rounds}.`,
      code: 'ROUND_CLOSED',
    });
  }
  if (ctx.sw.requests?.[team]?.[String(r)]) return res.status(409).json({ error: `There’s already a bye for round ${r}.`, code: 'ALREADY_BYE' });
  const { data, error } = await supabase.from('swiss_bye_requests')
    .insert({ tournament_id: id, team_id: team, round: r, kind, note: typeof note === 'string' && note.trim() ? note.trim() : null, requested_by: userId })
    .select('id, team_id, round, kind, status, note, created_at').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: `You’ve already asked for round ${r}.`, code: 'ALREADY_ASKED' });
    return res.status(500).json({ error: 'The request wasn’t saved. Try again.' });
  }
  const who = ctx.nameOf.get(team) ?? 'A player';
  await notifyUsers(await byeDeciders(ctx), {
    type: 'tournament', title: `${who} asks for a bye`,
    body: `Round ${r}: ${byeWords(kind)}. Approve or decline it on the Pairings desk.`, data: { tournamentId: id },
  }, { actorId: userId }).catch(() => undefined);
  return res.json({ ok: true, request: data });
}

/** DELETE /tournaments/:id/swiss/bye-requests/:reqId */
export async function withdrawSwissBye(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  const ctx = await swissContext(id);
  if (!ctx) return res.status(404).json({ error: 'This isn’t a Swiss tournament.', code: 'NOT_SWISS' });
  const { data: row } = await supabase.from('swiss_bye_requests').select('*').eq('id', String(req.params.reqId)).eq('tournament_id', id).maybeSingle();
  const r = row as ByeRequestRow | null;
  if (!r || !(await myEntries(ctx, userId)).includes(r.team_id)) return res.status(404).json({ error: 'That request isn’t yours.', code: 'NOT_FOUND' });
  if (r.status !== 'pending' && r.status !== 'approved') return res.status(409).json({ error: 'That request is already closed.', code: 'CLOSED' });
  if (r.round <= (ctx.sw.paired ?? 0)) return res.status(409).json({ error: `Round ${r.round} is already paired.`, code: 'ROUND_PAIRED' });
  await supabase.from('swiss_bye_requests').update({ status: 'withdrawn', decided_at: new Date().toISOString() }).eq('id', r.id).in('status', ['pending', 'approved']);
  if (r.status === 'approved') {
    await writeBye(ctx, id, r.team_id, r.round, null);
    await notifyUsers(await byeDeciders(ctx), { type: 'tournament', title: `${ctx.nameOf.get(r.team_id) ?? 'A player'} will play round ${r.round}`, body: 'They took back their bye.', data: { tournamentId: id } }, { actorId: userId }).catch(() => undefined);
  }
  return res.json({ ok: true });
}

/** POST /tournaments/:id/swiss/bye-requests/:reqId/decide */
export async function decideSwissBye(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.params.id);
  if (!(await canManagePairings(id, userId))) return res.status(403).json({ error: 'Only the organiser or an arbiter can decide a bye.' });
  const ctx = await swissContext(id);
  if (!ctx) return res.status(404).json({ error: 'This isn’t a Swiss tournament.', code: 'NOT_SWISS' });
  const approve = (req.body ?? {}).approve === true;
  const { data: row } = await supabase.from('swiss_bye_requests').select('*').eq('id', String(req.params.reqId)).eq('tournament_id', id).maybeSingle();
  const r = row as ByeRequestRow | null;
  if (!r) return res.status(404).json({ error: 'No such request.', code: 'NOT_FOUND' });
  if (r.status !== 'pending') return res.status(409).json({ error: 'That request is already decided.', code: 'DECIDED' });
  if (approve && r.round <= (ctx.sw.paired ?? 0)) return res.status(409).json({ error: `Round ${r.round} is already paired — decline it.`, code: 'ROUND_PAIRED' });
  const { data: claim } = await supabase.from('swiss_bye_requests')
    .update({ status: approve ? 'approved' : 'declined', decided_by: userId, decided_at: new Date().toISOString() })
    .eq('id', r.id).eq('status', 'pending').select('id');
  if (!claim || claim.length === 0) return res.status(409).json({ error: 'That request was just decided.', code: 'DECIDED' });
  if (approve) await writeBye(ctx, id, r.team_id, r.round, r.kind);
  await notifyUsers(await entryPlayers(r.team_id), {
    type: 'tournament', title: approve ? `Bye approved · round ${r.round}` : `Bye declined · round ${r.round}`,
    body: approve ? `You have ${byeWords(r.kind)} in round ${r.round} of ${(ctx.t as { name?: string }).name ?? 'the Swiss'}.` : `Your request for ${byeWords(r.kind)} in round ${r.round} was declined — you’ll be paired as usual.`,
    data: { tournamentId: id },
  }, { actorId: userId }).catch(() => undefined);
  return res.json({ ok: true, status: approve ? 'approved' : 'declined', redrafted: approve && (ctx.sw.draft?.round ?? null) === r.round });
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
