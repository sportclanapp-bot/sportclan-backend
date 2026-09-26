import { Request, Response } from 'express';
import { checkLease } from '../utils/scoringLease';
import { deviceIdOf } from '../utils/deviceHeader';
import { supabase } from '../utils/supabase';
import { pendingRankedOpponent } from '../utils/singles';
import { tennisReplay, type TennisScore } from '../utils/tennisCore';
import { scorePush, quarterPush } from '../utils/scorePush';
import { sanitizeError } from '../utils/response';
import { normalizeClientKey } from '../utils/idempotency';
import { notifyUsers } from '../utils/notify';
import { isTerminalMatchStatus } from '../utils/validation';
import { canOfficiateMatch } from '../utils/tournamentAuth';
import { isSportInactive } from '../utils/sports';
import { isKnownEventType } from '../utils/scoringEvents';
import { leaseRefusal } from '../utils/leaseCore';
import { getSport, normSportSlug } from '../utils/sportCache';
import { bestOfFor, winsNeeded } from '../utils/matchLength';
import { carromReplay, carromPieces, CARROM_MAX_PIECES, CARROM_QUEEN_POINTS } from '../utils/carromCore';
import { allOutBySide, isDismissal } from '../utils/cricketRules';
import { isValidChessReason } from '../utils/chessRules';

// Fire-and-forget: push the big moments of a live match (wickets, goals) to
// every participant in the match. Failures are swallowed — the fan-out must
// never block the scorer's UI.
async function fanoutScoreUpdate(
  matchId: string,
  title: string,
  body: string,
  actorId?: string,
): Promise<void> {
  try {
    // Participants + anyone who followed the match (SC-A1) — deduped.
    const [{ data: participants }, { data: followers }] = await Promise.all([
      supabase.from('match_participants').select('user_id').eq('match_id', matchId),
      supabase.from('match_followers').select('user_id').eq('match_id', matchId),
    ]);
    const userIds = Array.from(new Set([
      ...(participants || []).map((p) => p.user_id),
      ...(followers || []).map((f) => f.user_id),
    ]));
    if (userIds.length === 0) return;
    await notifyUsers(userIds, {
      type: 'score_update',
      title,
      body,
      data: { matchId, screen: 'MatchDetail' },
    }, { actorId });
  } catch (err) {
    // SC-112: best-effort fanout, but log the failure so it isn't invisible.
    console.error('[fanout-score-update] failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * The one gate for "may this person score this match from this device, right now".
 *
 * Exported for SC-432: the QR handoff has to ask the same question about the
 * SIGNER that this asks about the caller. A second, parallel copy of these checks
 * is exactly how a courier path quietly becomes more permissive than the direct
 * one.
 */
export async function authorizeScorer(matchId: string, userId: string, deviceId?: string | null) {
  const { data: match } = await supabase
    .from('matches')
    .select('id, created_by, umpire_id, score_summary, sport_id, status, is_ranked, tournament_id, voided_at, team_a_id, team_b_id, team_b_name')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return { ok: false as const, status: 404, error: 'Match not found' };
  if (!(await canOfficiateMatch(match, userId))) {
    return { ok: false as const, status: 403, error: match.tournament_id ? 'Only a tournament organiser or the umpire can score' : 'Only the umpire or creator can score' };
  }
  // SC-430: one scorer per match. Authorised is not the same as holding the pad —
  // two officiants scoring the same game do not corrupt anything, they simply BOTH
  // count, which is the quieter and worse failure. 409 so the client's outbox
  // treats it as an ordinary rejection: the queue halts, keeps every point, and
  // asks the human. See utils/scoringLease.
  const verdict = await checkLease(matchId, userId, deviceId);
  if (!verdict.ok) {
    const refusal = leaseRefusal(verdict);
    return {
      ok: false as const,
      status: 409,
      error: refusal.error,
      code: refusal.code,
      lease: verdict.lease,
    };
  }
  return { ok: true as const, match };
}


/**
 * SC-432 · the ONE idempotent way an event reaches the log.
 *
 * Extracted from createEvent so the QR handoff applies a scorer's queued ops
 * through exactly the same path rather than a parallel one that could drift. That
 * matters more than tidiness here: the handoff writes events with the SCORER as
 * `createdBy`, not the scanner, and `record_match_event` dedupes on
 * (created_by, client_key). Write them as the scanner and the scorer's own phone
 * would later re-send the same balls under a different author and DOUBLE-COUNT
 * every one of them.
 *
 * The fallback ladder is unchanged: 8-arg RPC (with p_client_key) → 7-arg → direct
 * insert, so this stays safe to deploy ahead of any migration.
 */
export async function recordEventIdempotent(args: {
  matchId: string;
  createdBy: string;
  eventType: string;
  period?: string | null;
  clockSeconds?: number | null;
  payload?: Record<string, unknown>;
  clientKey?: string | null;
}): Promise<{ event: any; error: any; wasNew: boolean }> {
  const baseArgs = {
    p_match_id: args.matchId,
    p_created_by: args.createdBy,
    p_event_type: args.eventType,
    p_period: args.period ?? null,
    p_clock_seconds: args.clockSeconds ?? null,
    p_payload: args.payload || {},
  };
  let rpc = await supabase.rpc('record_match_event', {
    ...baseArgs,
    p_client_key: normalizeClientKey(args.clientKey),
  });
  if (rpc.error && rpc.error.code === 'PGRST202') {
    rpc = await supabase.rpc('record_match_event', baseArgs);
  }
  if (rpc.error && rpc.error.code === 'PGRST202') {
    const ins = await supabase
      .from('match_events')
      .insert({
        match_id: args.matchId,
        event_type: args.eventType,
        period: args.period ?? null,
        clock_seconds: args.clockSeconds ?? null,
        payload: args.payload || {},
        created_by: args.createdBy,
      })
      .select('*')
      .single();
    return { event: ins.data, error: ins.error, wasNew: true };
  }
  const d = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
  if (d && typeof d === 'object' && 'was_new' in d) {
    return { event: (d as any).event, error: rpc.error, wasNew: (d as any).was_new };
  }
  return { event: d, error: rpc.error, wasNew: true };
}

// POST /scoring/:matchId/event
export async function createEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const matchId = String(req.params.matchId);
    const { event_type, period, clock_seconds, payload, idempotency_key } = req.body || {};
    if (!event_type) return res.status(400).json({ error: 'event_type is required' });
    // SC-408: an event nobody can read must not be accepted. Unknown types used
    // to persist with a 201 and then leak into the partnership view (which sums
    // payload.runs broadly) while the innings aggregator ignored them — two
    // numbers on one screen disagreeing, from the same ledger.
    if (!isKnownEventType(event_type)) {
      return res.status(400).json({
        error: `Unknown event_type "${String(event_type)}".`,
        code: 'UNKNOWN_EVENT_TYPE',
      });
    }

    const auth = await authorizeScorer(matchId, userId, deviceIdOf(req));
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
    const match = auth.match;

    // SC-335: an out-of-scope (deactivated) sport can't be scored at all — even a
    // crafted request against a leftover kabaddi/athletics seed match is rejected,
    // whatever the match status. Checked before the terminal guard so it's the
    // authoritative reason.
    if (await isSportInactive(match.sport_id)) {
      return res.status(400).json({ error: 'This sport is not available', code: 'SPORT_INACTIVE' });
    }

    // SC-42: a finished match is immutable — no more scoring events.
    if (isTerminalMatchStatus(match.status)) {
      return res.status(409).json({ error: 'This match is finished and can no longer be scored' });
    }

    // SC-228: validate numeric scoring inputs so a buggy/malicious client can't
    // corrupt a score (negative subtracts, huge inflates). Clean 400, no write.
    // Bounds by family: point/board `value` 1..3 (basketball 3-pointer, carrom
    // queen 3, rally 1); cricket `runs` 0..7 (dot ball .. six + overthrow buffer);
    // `period`/set/ply 0..2000; `clock_seconds` 0..86400 (≤24h). team_side A|B.
    const outOfRange = (v: unknown, min: number, max: number): boolean =>
      v != null && (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max);
    if (outOfRange(period, 0, 2000)) {
      return res.status(400).json({ error: 'period must be an integer between 0 and 2000' });
    }
    if (outOfRange(clock_seconds, 0, 86400)) {
      return res.status(400).json({ error: 'clock_seconds must be an integer between 0 and 86400' });
    }
    if (payload && typeof payload === 'object') {
      if (payload.team_side != null && payload.team_side !== 'A' && payload.team_side !== 'B') {
        return res.status(400).json({ error: 'team_side must be "A" or "B"' });
      }
      // A5: a carrom BOARD result carries what the board was worth (pieces left
      // 0–9, +3 queen) — the only score event worth more than 3 (or 0).
      const isBoard = payload.kind === 'board';
      if (isBoard) {
        if (outOfRange(payload.pieces_left, 0, CARROM_MAX_PIECES)) {
          return res.status(400).json({ error: `pieces_left must be an integer between 0 and ${CARROM_MAX_PIECES}` });
        }
        if (payload.queen != null && typeof payload.queen !== 'boolean') {
          return res.status(400).json({ error: 'queen must be true or false' });
        }
        if (outOfRange(payload.value, 0, CARROM_MAX_PIECES + CARROM_QUEEN_POINTS)) {
          return res.status(400).json({ error: 'value is out of range for a board' });
        }
      } else if (outOfRange(payload.value, 1, 3)) {
        return res.status(400).json({ error: 'value must be an integer between 1 and 3' });
      }
      if (outOfRange(payload.runs, 0, 7)) {
        return res.status(400).json({ error: 'runs must be an integer between 0 and 7' });
      }
    }

    // Phase 3 · decision 2: a RANKED singles match cannot start until the
    // opponent has accepted. Checked only before the first point (status still
    // scheduled) — once it is live, it was accepted. 409 so the scorer's outbox
    // halts and asks rather than dropping the point.
    // V-3: a serve swap before the first rally is a pre-match setting (the
    // toss), not play — it neither starts the match nor needs the opponent's yes.
    const startsPlay = event_type !== 'serve_swap';
    if (startsPlay && match.status === 'scheduled') {
      const gate = await pendingRankedOpponent(match);
      if (gate.pending) {
        return res.status(409).json({
          error: `${gate.opponentName ?? 'Your opponent'} hasn't accepted this ranked match yet. It can start once they do.`,
          code: 'OPPONENT_NOT_ACCEPTED',
        });
      }
    }

    // A3: a chess result's reason must be one of the shared list (chessRules —
    // the same list the app offers, incl. insufficient material / 50-move rule).
    if (event_type === 'result' && payload && typeof payload === 'object'
      && (payload.winner === 'white' || payload.winner === 'black' || payload.winner === 'draw')
      && !isValidChessReason(payload.winner, payload.reason)) {
      return res.status(400).json({ error: 'That isn’t a way this result can happen.', code: 'BAD_CHESS_REASON' });
    }

    // F-05 (confirmed live, session 1): a chess result names the player who won.
    // The app sent the WHITE player's id for "Black wins" (it always dispatched
    // results as side A), so the loser was credited and became Player of the
    // Match. A registered player named on a result must be on the winning side.
    if (event_type === 'result' && payload && typeof payload === 'object'
      && (payload.winner === 'white' || payload.winner === 'black')
      && typeof payload.player_id === 'string' && !isGuestId(payload.player_id)) {
      const wantSide = payload.winner === 'white' ? 'A' : 'B';
      const { data: part } = await supabase
        .from('match_participants').select('team_side')
        .eq('match_id', matchId).eq('user_id', payload.player_id).maybeSingle();
      if (part && (part as { team_side?: string }).team_side !== wantSide) {
        return res.status(400).json({
          error: `That player is on the other side — ${payload.winner === 'white' ? 'White' : 'Black'}'s player won.`,
          code: 'RESULT_PLAYER_WRONG_SIDE',
        });
      }
    }

    // Guest players (manual entry for casual matches) + untrusted-name hygiene.
    // Ranked matches are real-users-only (ELO/leaderboards) — reject guest ids
    // there as defence-in-depth (the app also hides guest mode for ranked).
    if (payload && typeof payload === 'object') {
      const ids = [payload.player_id, payload.batsman_id, payload.bowler_id];
      if (match.is_ranked && ids.some((v: unknown) => isGuestId(v as string))) {
        return res.status(400).json({ error: 'Ranked matches require registered players, not guests.' });
      }
      for (const k of ['player_name', 'batsman_name', 'bowler_name'] as const) {
        if (payload[k] != null) {
          const clean = sanitizePlayerName(payload[k]);
          if (clean) payload[k] = clean;
          else delete payload[k];
        }
      }

      // SC-442 (M6) · one person cannot bat and bowl the same delivery.
      //
      // The app's picker was letting a player from the FIELDING side be chosen
      // as striker, and then the same person as bowler — so one player batted
      // and bowled to himself, and the finished scorecard credited him with runs
      // he had scored for both teams. The picker is now restricted by side, but
      // the server must refuse it too: an old build keeps posting whatever it
      // likes, and this is the only place that sees every delivery.
      //
      // Deliberately narrow. The server cannot cheaply verify squad membership
      // for free-text and guest sides without a per-ball roster lookup, so it
      // asserts the one thing that is impossible in any form of cricket rather
      // than guessing at the rest.
      const batId = payload.batsman_id ?? payload.player_id;
      const bowlId = payload.bowler_id;
      if (batId && bowlId && batId === bowlId) {
        return res.status(400).json({
          error: 'The batter and the bowler cannot be the same player.',
          code: 'SAME_PLAYER_BOTH_ROLES',
        });
      }
    }

    // Catch-all: any scored event means the match is in progress, so promote it
    // to `live`. The toss handler already does this for the normal flow; this
    // covers the "skip toss" path where scoring starts without a recorded toss.
    // Guard so we never downgrade a completed/cancelled match.
    // F-24: only once every check above has passed — a REFUSED event (a chess
    // result with a bad reason or the wrong player, a guest in a ranked match,
    // one player batting and bowling) used to start the match anyway.
    if (startsPlay && match.status === 'scheduled') {
      try {
        await supabase.from('matches').update({ status: 'live' }).eq('id', matchId);
      } catch {
        // best-effort — don't block scoring on the status flip
      }
    }

    // SC-113: atomic, race-safe insert. record_match_event serializes per-match
    // (advisory lock) and dedupes a rapid/concurrent IDENTICAL submit (double-tap
    // / retry) → exactly one event, so recomputeSummary can't inflate the score.
    // Falls back to the direct insert until migration 049 (the RPC) is applied,
    // so deploying this ahead of the migration is safe (pre-fix behaviour).
    const rec = await recordEventIdempotent({
      matchId,
      createdBy: userId,
      eventType: event_type,
      period: period ?? null,
      clockSeconds: clock_seconds ?? null,
      payload: payload || {},
      clientKey: idempotency_key,
    });
    const { event, error, wasNew } = rec;
    if (error || !event) return res.status(500).json({ error: sanitizeError(error) });

    // Recompute the canonical score_summary from the full event log for ALL
    // sports (cricket runs/balls/wickets, football/hockey goals, basketball
    // points, rally/carrom sets/boards). Replaces the old cricket-only
    // incremental update — non-cricket scores were never persisted before
    // (A5-002), and recomputing from events kills drift entirely.
    try {
      await recomputeSummary(matchId);
    } catch {
      // ignore best-effort update errors
    }

    // PRD 12.1: fan out push notifications for wickets and goals. We don't
    // await — the scorer shouldn't block on push delivery.
    try {
      // Every sport notifies followers on a scoring event. Cricket emits
      // `wicket`; every other ruleset (football/hockey goals, basketball
      // points, rally/tennis/carrom points) emits the generic `score` event
      // (`goal` kept as a legacy alias). Non-scoring events (ball, note, card,
      // period_change) don't notify. Read the freshly-recomputed summary so the
      // notified score reflects this event.
      const isScoreEvent =
        event_type === 'wicket' || event_type === 'score' || event_type === 'goal';
      // SC-133: skip the fan-out on a dedup-hit (retry) — a deduped event is not new.
      if (isScoreEvent && wasNew) {
        const { data: fresh } = await supabase
          .from('matches')
          .select('score_summary, team_a_name, team_b_name')
          .eq('id', matchId)
          .maybeSingle();
        const summary: any = fresh?.score_summary || {};
        const side = (payload?.team_side as string) || 'A';
        const teamName = (s: string) =>
          s === 'A' ? (fresh?.team_a_name || 'Team A') : (fresh?.team_b_name || 'Team B');

        if (event_type === 'wicket') {
          // F-15: the app sends batsman_id / batsman_name. This read batter_name,
          // which nothing sends, so every wicket push said "Batter out". The
          // batter's runs come from the rollup the summary already carries.
          const batId = (payload?.batsman_id as string) || (payload?.player_id as string) || '';
          const line = batId ? summary?.players?.[batId] : null;
          const playerName =
            (payload?.batsman_name as string) || (payload?.batter_name as string) ||
            (payload?.player_name as string) || (line?.name as string) || 'Batter';
          const runs = payload?.batter_runs ?? payload?.runs_scored ?? (typeof line?.runs === 'number' ? line.runs : '');
          const inning: any = summary[side] || {};
          const scoreStr = `${inning.runs ?? 0}/${inning.wickets ?? 0}`;
          // Retired hurt is not a wicket — say what happened.
          const hurt = !isDismissal(payload?.wicket_type ?? payload?.type);
          const title = hurt ? 'Retired hurt' : 'Wicket!';
          const verb = hurt ? 'retired hurt on' : 'out for';
          const body =
            runs !== ''
              ? `${playerName} ${verb} ${runs} | ${teamName(side)} ${scoreStr}`
              : `${playerName} ${hurt ? 'retired hurt' : 'out'} | ${teamName(side)} ${scoreStr}`;
          void fanoutScoreUpdate(matchId, title, body, userId);
        } else {
          // V-5: sports scored in games/sets push when a game (tennis: a set)
          // ends, quoting it — not on every rally, and never "scores! 0-0".
          const slug = normSportSlug((await getSport(match.sport_id as string))?.slug);
          // F-15: an own goal is scored FOR the other side; team_side is the side
          // that conceded it. The push said the conceding team "scores!".
          const ownGoal = payload?.kind === 'own_goal';
          const forSide: 'A' | 'B' = ownGoal ? (side === 'B' ? 'A' : 'B') : side === 'B' ? 'B' : 'A';
          const push = scorePush({
            slug, summary, side: forSide, teamName: teamName(forSide), kind: payload?.kind as string | undefined,
            concedingName: ownGoal ? teamName(side) : undefined,
            prevSummary: (match.score_summary ?? null) as never, // before this event (F-04)
          });
          if (!push) return res.json({ event });
          const { title, body } = push;
          void fanoutScoreUpdate(matchId, title, body, userId);
        }
      }
    } catch {
      // ignore
    }

    // Basketball pushes once a quarter, not once a basket: the end of a quarter
    // is a period_change event. Q1–Q3 end here; the final is match_result.
    if (event_type === 'period_change' && wasNew) {
      try {
        const slug = normSportSlug((await getSport(match.sport_id as string))?.slug);
        if (slug === 'basketball') {
          const [{ count }, { data: fresh }] = await Promise.all([
            supabase.from('match_events').select('id', { count: 'exact', head: true })
              .eq('match_id', matchId).eq('event_type', 'period_change'),
            supabase.from('matches').select('score_summary, team_a_name, team_b_name').eq('id', matchId).maybeSingle(),
          ]);
          const { title, body } = quarterPush({
            quarter: count ?? 1,
            summary: (fresh?.score_summary ?? {}) as never,
            teamAName: fresh?.team_a_name || 'Team A',
            teamBName: fresh?.team_b_name || 'Team B',
          });
          void fanoutScoreUpdate(matchId, title, body, userId);
        }
      } catch {
        // best-effort, like every push
      }
    }

    return res.json({ event });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /scoring/:matchId/events
export async function listEvents(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const matchId = String(req.params.matchId);
    const { since, limit } = req.query as Record<string, string | undefined>;
    let query = supabase
      .from('match_events')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true })
      .limit(Math.min(parseInt(limit || '500', 10), 1000));
    if (since) query = query.gt('created_at', since);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ events: data || [] });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Per-sport set/board config for rally + carrom replay (mirrors the frontend
// rulesets in src/scoring/rules/*). target = points to win a set/board;
// cap = hard ceiling that ends a set without a 2-lead (badminton 30); maxSets =
// best-of; finalTarget = different target for the deciding set (volleyball 15);
// winBy2 = needs a 2-point lead (false for carrom boards).
export const SET_CONFIG: Record<
  string,
  { target: number; cap?: number; maxSets: number; finalTarget?: number; winBy2: boolean }
> = {
  badminton:   { target: 21, cap: 30, maxSets: 3, winBy2: true },
  tabletennis: { target: 11, maxSets: 5, winBy2: true },
  pickleball:  { target: 11, maxSets: 3, winBy2: true },
  volleyball:  { target: 25, maxSets: 5, finalTarget: 15, winBy2: true },
  carrom:      { target: 25, maxSets: 3, winBy2: false }, // boards to 25, no 2-lead
  // Tennis is NOT here (T-1): this table reads each 'score' event as a whole
  // game/board, and tennis events are POINTS. It has its own branch in
  // recomputeSummary, replayed through the shared tennisCore.
};

/**
 * F-01 (confirmed live, session 1): for the best-of sports, how many sets/games/
 * boards win the match, and whether a canonical summary says someone has.
 * Null for sports that are not best-of (goals, points, runs, chess).
 */
export function bestOfState(slug: string, summary: Record<string, any> | null | undefined, format?: string | null):
  { needed: number; decided: boolean; scored: boolean; leader: 'A' | 'B' | null } | null {
  // Decision B: the match's own length preset (matchLength.ts, shared with the app).
  const bestOf = bestOfFor(slug, format);
  if (bestOf === null) return null;
  const needed = winsNeeded(bestOf);
  const a = Number(summary?.A?.score ?? 0);
  const b = Number(summary?.B?.score ?? 0);
  const scored = a + b > 0
    || (summary?.A?.sets?.length ?? 0) > 0 || (summary?.B?.sets?.length ?? 0) > 0
    || Number(summary?.A?.points ?? 0) + Number(summary?.B?.points ?? 0) > 0
    || Number(summary?.A?.games ?? 0) + Number(summary?.B?.games ?? 0) > 0;
  return { needed, decided: Math.max(a, b) >= needed, scored, leader: a > b ? 'A' : b > a ? 'B' : null };
}

function setWon(
  a: number, b: number, target: number, cap: number | undefined, winBy2: boolean,
): 'A' | 'B' | null {
  if (cap != null) {
    if (a >= cap) return 'A';
    if (b >= cap) return 'B';
  }
  if (a >= target && (!winBy2 || a - b >= 2)) return 'A';
  if (b >= target && (!winBy2 || b - a >= 2)) return 'B';
  return null;
}

/**
 * Replay rally/carrom score events into sets.
 *
 * U-29: once a side has won ceil(maxSets/2) sets the match is decided and
 * nothing after it counts. The loop used to open a new set after the decider
 * like after any other, so a finished best-of-3 carried an empty 4th set, and
 * any stray point after the decider was scored into it.
 */
export function rollupSets(
  cfg: { target: number; cap?: number; maxSets: number; finalTarget?: number; winBy2: boolean },
  events: { event_type: string; payload: any }[],
  sideOf: (p: any) => 'A' | 'B',
): { setsA: number; setsB: number; setScoresA: number[]; setScoresB: number[]; curA: number; curB: number; decided: 'A' | 'B' | null } {
  const need = Math.ceil(cfg.maxSets / 2);
  let curA = 0, curB = 0, setsA = 0, setsB = 0, period = 1;
  let decided: 'A' | 'B' | null = null;
  const setScoresA: number[] = [], setScoresB: number[] = [];
  for (const e of events) {
    if (decided) break;
    if (e.event_type !== 'score') continue;
    const p: any = e.payload || {};
    // Rally points are 1; carrom pieces/queen carry value (1 or 3).
    const v = Number(p.value ?? 1);
    if (sideOf(p) === 'A') curA += v; else curB += v;
    const target = cfg.finalTarget && period === cfg.maxSets ? cfg.finalTarget : cfg.target;
    const w = setWon(curA, curB, target, cfg.cap, cfg.winBy2);
    if (w) {
      setScoresA.push(curA); setScoresB.push(curB);
      if (w === 'A') setsA += 1; else setsB += 1;
      curA = 0; curB = 0; period += 1;
      if (setsA >= need) decided = 'A';
      else if (setsB >= need) decided = 'B';
    }
  }
  return { setsA, setsB, setScoresA, setScoresB, curA, curB, decided };
}

// Per-player cricket rollup (A5-003/004). Player identity rides in the event
// payload (`batsman_id` / `bowler_id`, or `player_id` as a batting fallback) —
// there are no dedicated columns on match_events. The batting `team_side` in
// the payload is the batter's team; the bowler is always on the opposite side,
// so a given user resolves to the same `side` whether batting or bowling.
//
// Returns a map keyed by user_id. Events without attribution simply don't
// contribute here (the per-side totals in recomputeSummary still count them),
// so casual/unattributed matches yield an empty map and behave as before.
export interface CricketPlayerLine {
  side: 'A' | 'B';
  name?: string; // SC-14/guest: display name captured from the event payload
  runs: number; balls: number; fours: number; sixes: number;
  out: boolean; dismissal?: string;
  /**
   * F-36 · who ELSE was in the dismissal, so a scorecard can read "c Sharma b
   * Khan" rather than the bare kind. Carried on the line because the rollup is
   * the only thing the app reads — it never sees the raw events.
   */
  dismissal_fielder?: string; dismissal_bowler?: string;
  bowl_balls: number; bowl_runs: number; bowl_wickets: number;
  /** F-15: overs of six legal balls with nothing charged to this bowler (maidens were always 0). */
  bowl_maidens: number;
  /**
   * Fielding credit. These have existed as columns on innings_stats since the
   * table was created and were written as a literal 0 for every player of every
   * match, because the app sent no fielder and there was nothing to count.
   */
  catches: number; runouts: number; stumpings: number;
}

export function aggregateCricketPlayers(
  events: { event_type: string; payload: any }[],
): Record<string, CricketPlayerLine> {
  const players: Record<string, CricketPlayerLine> = {};
  const ensure = (id: string, side: 'A' | 'B', name?: string): CricketPlayerLine => {
    if (!players[id]) {
      players[id] = {
        side, runs: 0, balls: 0, fours: 0, sixes: 0, out: false,
        bowl_balls: 0, bowl_runs: 0, bowl_wickets: 0, bowl_maidens: 0,
        catches: 0, runouts: 0, stumpings: 0,
      };
    }
    // First non-empty name wins — lets the scorecard/MVP resolve a real name
    // straight from the rollup (fixes SC-52) and names guest players too.
    if (name && !players[id]!.name) players[id]!.name = name;
    return players[id]!;
  };
  // F-15 · maidens. The over in progress per batting side: its legal balls, its
  // bowler (undefined until the first delivery; a change mid-over spoils it),
  // and the runs charged to the bowler (bat runs, wides, no-balls — not byes or
  // leg-byes). Needs the events in order, which both callers that persist it
  // (recompute and writeCricketInningsStats) read by created_at.
  const overs: Record<'A' | 'B', { legal: number; bowler?: string | null; charged: number; clean: boolean }> = {
    A: { legal: 0, charged: 0, clean: true },
    B: { legal: 0, charged: 0, clean: true },
  };
  const delivery = (side: 'A' | 'B', bowlId: string | undefined, legal: boolean, charged: number) => {
    const o = overs[side];
    if (o.bowler === undefined) o.bowler = bowlId ?? null;
    if ((bowlId ?? null) !== o.bowler) o.clean = false;
    o.charged += charged;
    if (!legal) return;
    o.legal += 1;
    if (o.legal < 6) return;
    if (o.clean && o.bowler && o.charged === 0 && players[o.bowler]) players[o.bowler]!.bowl_maidens += 1;
    overs[side] = { legal: 0, charged: 0, clean: true };
  };
  // A retired-hurt batter who bats again is back in: the "retired hurt" note
  // goes (they end not out, or out by whatever gets them later).
  const resumed = (id: string | undefined) => {
    const b = id ? players[id] : undefined;
    if (b && !b.out && b.dismissal === 'retired_hurt') delete b.dismissal;
  };
  for (const e of events) {
    const p: any = e.payload || {};
    const batSide: 'A' | 'B' = p.team_side === 'B' ? 'B' : 'A';
    const bowlSide: 'A' | 'B' = batSide === 'A' ? 'B' : 'A';
    const batId: string | undefined = p.batsman_id || p.player_id;
    const bowlId: string | undefined = p.bowler_id;
    const batName: string | undefined = p.batsman_name || p.player_name;
    const bowlName: string | undefined = p.bowler_name;
    if (bowlId && (e.event_type === 'ball' || e.event_type === 'extra' || e.event_type === 'wicket')) ensure(bowlId, bowlSide, bowlName);
    if (e.event_type === 'ball') delivery(batSide, bowlId, !p.is_extra, Number(p.runs ?? 0));
    else if (e.event_type === 'extra') {
      const legalExtra = p.type === 'B' || p.type === 'Lb';
      delivery(batSide, bowlId, legalExtra, legalExtra ? 0 : Number(p.runs ?? 0));
    } else if (e.event_type === 'wicket' && !p.is_extra) delivery(batSide, bowlId, true, 0);
    if (e.event_type === 'ball' || e.event_type === 'extra' || (e.event_type === 'wicket' && isDismissal(p.wicket_type || p.type))) resumed(batId);
    if (e.event_type === 'ball') {
      const runs = Number(p.runs ?? 0);
      if (batId) {
        const b = ensure(batId, batSide, batName);
        if (!p.is_extra) b.balls += 1;
        b.runs += runs;
        if (runs === 4) b.fours += 1;
        if (runs === 6) b.sixes += 1;
      }
      if (bowlId) {
        const w = ensure(bowlId, bowlSide, bowlName);
        if (!p.is_extra) w.bowl_balls += 1;
        w.bowl_runs += runs;
      }
    } else if (e.event_type === 'extra') {
      const runs = Number(p.runs ?? 0);
      const legal = p.type === 'B' || p.type === 'Lb'; // byes/leg-byes are legal balls
      if (batId && legal) ensure(batId, batSide, batName).balls += 1; // ball faced, runs are extras (not the batter's)
      // Decision 2026-09-26 (MATCH_CREATE_TEST_5): runs on a no-ball are off the
      // bat. Stored runs include the 1-run penalty, so NB + N gives the striker N
      // and a ball faced; the bowler is still charged all of it (below), and it is
      // still no ball of the over. The app's utils/cricketCredit is the same rule.
      if (batId && p.type === 'Nb') {
        const b = ensure(batId, batSide, batName);
        const offBat = Math.max(0, runs - 1);
        b.balls += 1;
        b.runs += offBat;
        if (offBat === 4) b.fours += 1;
        if (offBat === 6) b.sixes += 1;
      }
      if (bowlId) {
        const w = ensure(bowlId, bowlSide, bowlName);
        if (legal) w.bowl_balls += 1; // byes/leg-byes NOT charged to the bowler
        else w.bowl_runs += runs;     // wides/no-balls ARE charged to the bowler
      }
    } else if (e.event_type === 'wicket') {
      // Normalised once, and used by all three of the rules below. Until F-36
      // the app sent nothing at all, so this was the empty string for EVERY
      // wicket ever recorded — which is not 'runout', so the bowler was credited
      // with every run-out in the match. The rule was right; it was never fed.
      const wt = String(p.wicket_type || p.type || '').toLowerCase().replace(/[^a-z]/g, '');
      const fielderId: string | undefined = p.fielder_id;
      const fielderName: string | undefined = p.fielder_name;
      if (batId) {
        const b = ensure(batId, batSide, batName);
        if (!p.is_extra) b.balls += 1;
        if (!isDismissal(wt)) {
          // Retired hurt: off the field, NOT out — "retired hurt" on the
          // scorecard until they bat again (see resumed() above).
          b.out = false;
          b.dismissal = 'retired_hurt';
          delete b.dismissal_fielder;
          delete b.dismissal_bowler;
        } else {
          b.out = true;
          b.dismissal = p.wicket_type || p.type || 'out';
          if (fielderName) b.dismissal_fielder = fielderName;
          if (bowlName && wt !== 'retiredout') b.dismissal_bowler = bowlName;
        }
      }
      if (bowlId) {
        const w = ensure(bowlId, bowlSide, bowlName);
        if (!p.is_extra) w.bowl_balls += 1;
        // Run-outs / retirements (hurt or out) aren't credited to the bowler.
        if (wt !== 'runout' && wt !== 'retired' && wt !== 'retiredhurt' && wt !== 'retiredout') w.bowl_wickets += 1;
      }
      // The fielder is on the BOWLING side — crediting them to the batting side
      // would put a catch in the batting card, which is how a fielding stat gets
      // quietly attributed to the wrong team.
      if (fielderId) {
        const f = ensure(fielderId, bowlSide, fielderName);
        if (wt === 'caught') f.catches += 1;
        else if (wt === 'runout') f.runouts += 1;
        else if (wt === 'stumped') f.stumpings += 1;
      }
    }
  }
  return players;
}

// ─── Non-cricket per-player rollups (SC-14) ─────────────────────────────────
// Same contract as aggregateCricketPlayers: keyed by user_id, driven by the
// `player_id` the scorer credits per event (the SportScoringScreen "Credit
// player" picker). Events without player_id don't contribute — casual/skipped
// attribution yields an empty map, exactly like cricket.
export interface GoalPlayerLine {
  side: 'A' | 'B'; name?: string; goals: number; assists: number;
  /** 2026-09-26: cards credited to this player (the pad asks who got it; optional). */
  yellow_cards?: number; red_cards?: number; green_cards?: number;
}
export interface PointPlayerLine { side: 'A' | 'B'; name?: string; points: number; assists: number }
export interface RallyPlayerLine { side: 'A' | 'B'; name?: string; points: number }
export type PlayerLine = CricketPlayerLine | GoalPlayerLine | PointPlayerLine | RallyPlayerLine;

const sideOfPayload = (p: any): 'A' | 'B' => (p?.team_side === 'B' ? 'B' : 'A');

// ─── Guest players (manual entry for casual matches) ────────────────────────
// Casual/free-text matches have no roster. The scorer can type player names;
// the app mints a stable `guest:<uuid>` id per player and stamps it (with
// `player_name`) on each event, so guests ride the SAME player_id-keyed
// attribution rails as registered users. Guest ids must NEVER be treated as a
// real user_id — they carry no users row, and must be excluded from any
// users/FK lookup (MVP mvp_user_id, innings_stats, ELO/leaderboard).
export const GUEST_PREFIX = 'guest:';
export const isGuestId = (id: string | null | undefined): boolean =>
  typeof id === 'string' && id.startsWith(GUEST_PREFIX);

// Scorer-typed player name is untrusted input — trim, strip control chars,
// collapse whitespace, and cap length so it can't bloat the payload or break
// display. Returns undefined for empty/whitespace-only names.
export function sanitizePlayerName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return clean.length ? clean : undefined;
}

// Capture the display name a payload carries for a given player-id key, so the
// aggregates can store it once (first non-empty wins).
const nameFromPayload = (p: any): string | undefined =>
  sanitizePlayerName(p?.player_name);

// Goal sports (football, hockey): goals + assists per scorer.
export function aggregateGoalPlayers(events: { event_type: string; payload: any }[]): Record<string, GoalPlayerLine> {
  const players: Record<string, GoalPlayerLine> = {};
  for (const e of events) {
    const p = e.payload ?? {};
    const id: string | undefined = p.player_id;
    if (!id) continue;
    const isGoal = e.event_type === 'score' && p.kind === 'goal';
    const isAssist = e.event_type === 'assist';
    const card = e.event_type === 'card' && (p.kind === 'yellow' || p.kind === 'red' || p.kind === 'green') ? (p.kind as 'yellow' | 'red' | 'green') : null;
    if (!isGoal && !isAssist && !card) continue;
    const line = (players[id] ??= { side: sideOfPayload(p), goals: 0, assists: 0 });
    if (!line.name) { const nm = nameFromPayload(p); if (nm) line.name = nm; }
    if (isGoal) line.goals += 1;
    if (isAssist) line.assists += 1;
    if (card) line[`${card}_cards`] = (line[`${card}_cards`] ?? 0) + 1;
  }
  return players;
}

// Point sports (basketball): points (payload.value) + assists per scorer.
export function aggregatePointPlayers(events: { event_type: string; payload: any }[]): Record<string, PointPlayerLine> {
  const players: Record<string, PointPlayerLine> = {};
  for (const e of events) {
    const p = e.payload ?? {};
    const id: string | undefined = p.player_id;
    if (!id) continue;
    if (e.event_type === 'score' || e.event_type === 'basket') {
      const line = (players[id] ??= { side: sideOfPayload(p), points: 0, assists: 0 });
      if (!line.name) { const nm = nameFromPayload(p); if (nm) line.name = nm; }
      line.points += Number(p.value ?? 0);
    } else if (e.event_type === 'assist') {
      const line = (players[id] ??= { side: sideOfPayload(p), points: 0, assists: 0 });
      if (!line.name) { const nm = nameFromPayload(p); if (nm) line.name = nm; }
      line.assists += 1;
    }
  }
  return players;
}

// Rally/set + board + generic score sports (badminton, tennis, tabletennis,
// pickleball, volleyball, carrom, kabaddi, athletics): points/rallies won.
// Carrom's queen carries value 3, so summing payload.value (default 1) is right.
export function aggregateRallyPlayers(events: { event_type: string; payload: any }[]): Record<string, RallyPlayerLine> {
  const players: Record<string, RallyPlayerLine> = {};
  for (const e of events) {
    const p = e.payload ?? {};
    const id: string | undefined = p.player_id;
    if (!id) continue;
    if (e.event_type !== 'score' && e.event_type !== 'point') continue;
    const line = (players[id] ??= { side: sideOfPayload(p), points: 0 });
    if (!line.name) { const nm = nameFromPayload(p); if (nm) line.name = nm; }
    line.points += Number(p.value ?? 1);
  }
  return players;
}

// Dispatcher: route a match's events to the right per-family rollup. Cricket
// goes through the EXISTING, verified aggregateCricketPlayers unchanged (its
// output is byte-identical). Chess has no scoring events → empty map (MVP is
// decided by winner side). `slug` must be the normalised form.
export function aggregatePlayers(slug: string, events: { event_type: string; payload: any }[]): Record<string, PlayerLine> {
  if (slug === 'cricket') return aggregateCricketPlayers(events);
  if (slug === 'football' || slug === 'hockey') return aggregateGoalPlayers(events);
  if (slug === 'basketball') return aggregatePointPlayers(events);
  return aggregateRallyPlayers(events);
}

// Recompute a match's score_summary from the authoritative event log, for ALL
// sports, into the canonical shape:
//   { A: { score, …sport detail }, B: { … }, …preserved keys (result/winner_side) }
// `score` is the single cross-sport comparator (cricket: runs; football/hockey:
// goals; basketball: points; rally/carrom: sets/boards won). Recomputing from
// events (rather than incremental updates) means the stored summary can never
// drift out of sync with the events. Used after every scored event, after an
// undo, and at completion. Replaces the old cricket-only recompute.
/**
 * `persist: false` builds the summary without writing it — for completion,
 * whose result patch writes this same summary (plus the result) one step later.
 */
export async function recomputeSummary(matchId: string, opts: { persist?: boolean } = {}): Promise<Record<string, any> | null> {
  // The match and its events are independent reads — fetched together, and the
  // sport comes from the process cache: this runs on EVERY scoring event and at
  // completion, and each sequential round-trip costs ~300 ms from Render.
  const [{ data: match }, { data: events }] = await Promise.all([
    supabase.from('matches').select('sport_id, score_summary, format').eq('id', matchId).maybeSingle(),
    supabase.from('match_events').select('event_type, payload, clock_seconds, period').eq('match_id', matchId)
      .order('created_at', { ascending: true }),
  ]);
  if (!match) return null;
  const sportRow = await getSport(match.sport_id as string);
  // Normalise the slug so hyphenated/underscored slugs (e.g. 'table-tennis')
  // match the single-token keys in SET_CONFIG / the family checks below.
  // Previously 'table-tennis' fell through to the generic point tally instead
  // of set scoring — the same class of gap as SC-15 (tennis).
  const slug = normSportSlug(sportRow?.slug);

  const existing = (match.score_summary as Record<string, any>) || {};
  // Never wipe a pre-existing summary (e.g. seeded/legacy data) when there are
  // no scoring events to recompute from.
  if (!events || events.length === 0) return existing;

  const A: Record<string, any> = { score: 0 };
  const B: Record<string, any> = { score: 0 };
  let tennisState: TennisScore | null = null;
  let carromBoardsPlayed: number | null = null; // A5: boards played in the carrom game in play
  const sides: Record<'A' | 'B', Record<string, any>> = { A, B };
  const sideOf = (p: any): 'A' | 'B' => ((p?.team_side as 'A' | 'B') === 'B' ? 'B' : 'A');
  let chessResult: string | null = null; // SC-47
  let chessWinner: 'A' | 'B' | 'tie' | null = null;
  // The winning player the scorer credited on the last decisive result event
  // (guest-capable). Populates score_summary.players so casual/guest chess has
  // an MVP candidate — chess has no scoring events, so the generic rollup is
  // empty. A draw clears these (no winner → no MVP).
  let chessWinnerId: string | null = null;
  let chessWinnerName: string | null = null;
  // SC-191 follow-up (chess move/clock tracking, no fabricated data): fold the
  // real `move` events (each carries the mover's remaining clock in
  // clock_seconds + move number in period) into dual clocks + a move count, and
  // the result event's `reason` (checkmate/resignation/timeout/draw_*).
  let chessReason: string | null = null;
  let chessMoveCount = 0;
  let chessLastPly = 0;
  let chessClockWhite: number | null = null; // seconds remaining after White's last move
  let chessClockBlack: number | null = null;

  let cricketFirstBat: 'A' | 'B' | null = null;
  if (slug === 'cricket') {
    for (const s of ['A', 'B'] as const) Object.assign(sides[s], { runs: 0, balls: 0, wickets: 0 });
    // A6: a side is all out one short of its line-up (shared cricketRules); a
    // side with no line-up at 10, as before.
    const { data: lineup } = await supabase.from('match_participants').select('team_side').eq('match_id', matchId);
    const allOut = allOutBySide(lineup ?? []);
    for (const e of events) {
      const p: any = e.payload || {};
      const inn = sides[sideOf(p)];
      // F-15: who batted first, from play — the side on the first delivery. The
      // result reads it when no toss was recorded, to tell a chase from a defence.
      if (cricketFirstBat === null && (e.event_type === 'ball' || e.event_type === 'extra' || e.event_type === 'wicket')) {
        cricketFirstBat = sideOf(p);
      }
      if (e.event_type === 'ball') { inn.runs += Number(p.runs ?? 0); if (!p.is_extra) inn.balls += 1; }
      else if (e.event_type === 'extra') {
        inn.runs += Number(p.runs ?? 0);
        // Byes / leg-byes ARE legal deliveries (the over progresses); wides /
        // no-balls are not. Count the ball accordingly (A5-010/A5-012).
        if (p.type === 'B' || p.type === 'Lb') inn.balls += 1;
      }
      // Retired hurt is not a wicket (cricketRules.isDismissal): the batter
      // leaves and may return; the side is not a wicket down.
      else if (e.event_type === 'wicket') { if (isDismissal(p.wicket_type ?? p.type)) inn.wickets = Math.min(allOut[sideOf(p)], inn.wickets + 1); if (!p.is_extra) inn.balls += 1; }
      // A batting side can end its innings early by declaring (before all-out /
      // overs). This is a marker only — it doesn't change runs/balls/wickets or
      // the winner (still total-vs-total); it just lets the scorecard show
      // "150/3 dec". The innings-flip itself is driven on the FE.
      else if (e.event_type === 'declaration') { inn.declared = true; }
      inn.score = inn.runs;
    }
  } else if (slug === 'football' || slug === 'hockey') {
    for (const e of events) {
      const p: any = e.payload || {};
      if (e.event_type !== 'score') continue;
      // A normal goal credits the scoring side; an own goal credits the
      // OPPONENT of the side that put it in their own net (payload.team_side is
      // the side that conceded it — resolved here, never stored, so it can't
      // drift). Own goals are (correctly) not credited to any player's tally in
      // aggregateGoalPlayers, which counts only kind === 'goal'.
      if (p.kind === 'goal') sides[sideOf(p)].score += 1;
      else if (p.kind === 'own_goal') sides[sideOf(p) === 'A' ? 'B' : 'A'].score += 1;
    }
    A.goals = A.score; B.goals = B.score;
  } else if (slug === 'basketball') {
    for (const e of events) {
      const p: any = e.payload || {};
      if (e.event_type === 'score') sides[sideOf(p)].score += Number(p.value ?? 0);
    }
    A.points = A.score; B.points = B.score;
  } else if (slug === 'tennis') {
    // T-1/T-2 · per-POINT events through the shared rule (utils/tennisCore, the
    // same file the app scores with): points → games → sets, with a real 6-6
    // tiebreak. The server used to count every point as a GAME.
    // Decision B: "1 set" or "best of 3" — the match's preset.
    tennisState = tennisReplay(
      events.filter((e) => e.event_type === 'score').map((e) => sideOf(e.payload || {})),
      winsNeeded(bestOfFor('tennis', match.format) ?? 3),
    );
    A.score = tennisState.setsWon.A; B.score = tennisState.setsWon.B;       // sets won
    A.sets = tennisState.sets.map((x) => x.A); B.sets = tennisState.sets.map((x) => x.B); // games per set
    A.games = tennisState.games.A; B.games = tennisState.games.B;           // current set
    A.points = tennisState.points.A; B.points = tennisState.points.B;       // current game / tiebreak
  } else if (slug === 'carrom' && events.some((e) => e.event_type === 'score' && (e.payload as any)?.kind === 'board')) {
    // A5 · real carrom rules through the shared carromCore (the file the app
    // scores with): boards → games to 25 → best of 1 or 3 games. A carrom match
    // scored before this (+1 piece events, no board events) keeps the old rollup
    // below, so its record reads as it always did.
    const c = carromReplay(
      events
        .filter((e) => e.event_type === 'score' && (e.payload as any)?.kind === 'board')
        .map((e) => {
          const p: any = e.payload || {};
          return { winner: sideOf(p), piecesLeft: carromPieces(p.pieces_left), queen: p.queen === true };
        }),
      winsNeeded(bestOfFor('carrom', match.format) ?? 3),
    );
    A.score = c.gamesWon.A; B.score = c.gamesWon.B;                        // games won
    A.sets = c.games.map((g) => g.A); B.sets = c.games.map((g) => g.B);    // each game's final score
    A.points = c.points.A; B.points = c.points.B;                          // the game in play
    carromBoardsPlayed = c.boards;
  } else if (SET_CONFIG[slug]) {
    // Decision B: best-of from the match's preset (the deciding set is still the
    // last possible one, so a best-of-3 volleyball match plays its 3rd to 15).
    const cfg = { ...SET_CONFIG[slug]!, maxSets: bestOfFor(slug, match.format) ?? SET_CONFIG[slug]!.maxSets };
    const r = rollupSets(cfg, events, sideOf);
    A.score = r.setsA; B.score = r.setsB;
    A.sets = r.setScoresA; B.sets = r.setScoresB;
    A.points = r.curA; B.points = r.curB; // current in-progress set/board
  } else if (slug === 'chess') {
    // SC-47: chess records a single `result` event ({winner: white|black|draw}).
    // Reflect it as A/B scores (1-0 / 0-1 / ½-½) plus a result string + winner
    // side, so the summary is correct for BOTH registered-team and free-text
    // games (previously the result event was ignored → always "Match Draw").
    // The last result event wins.
    for (const e of events) {
      if (e.event_type === 'move') {
        // Real move data (never fabricated): each `move` event is one ply and
        // carries the mover's remaining clock. side 'A'=White, 'B'=Black.
        chessMoveCount += 1;
        const per = (e as any).period;
        chessLastPly = typeof per === 'number' ? per : chessMoveCount;
        const mv: any = e.payload || {};
        const side: 'A' | 'B' = mv.side === 'B' ? 'B' : 'A';
        const clk = (e as any).clock_seconds;
        if (typeof clk === 'number') {
          if (side === 'A') chessClockWhite = clk;
          else chessClockBlack = clk;
        }
        continue;
      }
      if (e.event_type !== 'result') continue;
      const pr = (e.payload || {}) as any;
      const w = pr.winner;
      if (w === 'white') { A.score = 1; B.score = 0; chessResult = 'White wins'; chessWinner = 'A'; }
      else if (w === 'black') { A.score = 0; B.score = 1; chessResult = 'Black wins'; chessWinner = 'B'; }
      else if (w === 'draw') { A.score = 0.5; B.score = 0.5; chessResult = 'Draw'; chessWinner = 'tie'; }
      else continue;
      // Result reason (checkmate/resignation/timeout/draw_agreement/stalemate/
      // repetition) — user-entered on the decisive result, no engine needed.
      chessReason = typeof pr.reason === 'string' ? pr.reason : null;
      // Capture the winner the scorer credited on THIS result event (the last
      // decisive result wins, matching the score above). A draw carries no
      // winning player. player_id may be a guest:<id> — that's fine, it rides
      // the same rail and is resolved name-only downstream.
      chessWinnerId = w === 'draw' ? null : (pr.player_id ?? null);
      chessWinnerName = w === 'draw' ? null : (sanitizePlayerName(pr.player_name) ?? null);
    }
  } else {
    // Generic fallback: count scoring events per side so SOMETHING persists for
    // sports without bespoke logic (no worse than today, where nothing did).
    for (const e of events) {
      const p: any = e.payload || {};
      if (['score', 'point', 'basket', 'goal'].includes(e.event_type)) {
        sides[sideOf(p)].score += Number(p.value ?? 1);
      }
    }
  }

  const summary: Record<string, any> = { ...existing, A, B };
  if (slug === 'cricket') summary.first_batting_side = cricketFirstBat;
  if (slug === 'chess') {
    summary.result = chessResult ?? 'No result yet';
    summary.winner_side = chessWinner;
    // Real move/clock rollup (no eval, no SAN — those need an engine / heavy
    // entry and stay deferred). time_control is the match's format string.
    summary.chess = {
      time_control: (match as any).format ?? null,
      move_count: chessMoveCount,
      last_ply: chessLastPly,
      clock_white: chessClockWhite,
      clock_black: chessClockBlack,
      result: chessResult ?? 'No result yet',
      reason: chessReason,
    };
  }
  if (slug === 'tennis') {
    // Tier 1 serve stats (aces + double faults) from real per-point events.
    // ACE → point to server + ace credited to server; D-FAULT → point to
    // returner + double_fault credited to the serving side (payload.server_side).
    // Serve % / 1st-serve-win% (Tier 2) stays deferred — needs per-serve in/out.
    const serve = { A: { aces: 0, double_faults: 0 }, B: { aces: 0, double_faults: 0 } };
    for (const e of events) {
      if (e.event_type !== 'score') continue;
      const p: any = e.payload || {};
      const server: 'A' | 'B' | null = p.server_side === 'B' ? 'B' : p.server_side === 'A' ? 'A' : null;
      if (!server) continue;
      if (p.kind === 'ace') serve[server].aces += 1;
      else if (p.kind === 'double_fault') serve[server].double_faults += 1;
    }
    summary.serve = serve;
  }
  // A5-003/004 + SC-14 · attach the additive per-player rollup for ALL sports so
  // the scorecard/MVP can read real per-player figures. Cricket routes through
  // the original aggregateCricketPlayers (byte-identical); other families get
  // goals/points/rally-points. Side totals (A/B) above are untouched, so results
  // and the A7-002 results surface don't change.
  summary.players = aggregatePlayers(slug, events as any[]);
  if (carromBoardsPlayed !== null) summary.boards_played = carromBoardsPlayed;
  if (tennisState) {
    // The tiebreak in play, and each completed set's tiebreak points (or null),
    // so a hub card or result can say "7–6 (7–5)".
    summary.tiebreak = tennisState.tiebreak;
    summary.set_tiebreaks = tennisState.sets.map((x) => x.tiebreak ?? null);
  }
  // Chess has no scoring events, so aggregatePlayers yields an empty map. Instead
  // represent the credited WINNER as a 1-entry rollup keyed by their player_id
  // (guest-safe) with { name, side: winner_side }, so the scorecard/MVP can
  // attribute the result for casual/guest chess (registered chess already had a
  // participant fallback). A draw → empty map → no MVP.
  if (slug === 'chess') {
    summary.players = chessWinnerId
      ? { [chessWinnerId]: { side: chessWinner, name: chessWinnerName ?? undefined, points: 1 } }
      : {};
  }
  if (opts.persist !== false) {
    await supabase
      .from('matches')
      .update({ score_summary: summary, updated_at: new Date().toISOString() })
      .eq('id', matchId);
  }
  // SC-442 (M1/B2-b) · carry the TOSS across the recompute.
  //
  // matches.controller sets score_summary.toss_winner_side when the toss is
  // recorded — it is the only place the batting order survives for free-text
  // teams, whose toss_winner_team_id is null — and its comment there claims
  // "recomputeSummary preserves this key". It did not. This function rebuilds
  // the summary from events, and the toss is not an event, so the key was
  // dropped on the next recompute.
  //
  // That made M1's cricket result WRONG in a way that looked like M1's fault: a
  // successful chase reported "won by N runs" instead of "by N wickets", because
  // deriveResultText asks who was chasing, chasingSide needs the toss, and by
  // then the toss was gone. Verified on device — the derivation was right all
  // along and simply never got its input.
  // The same applies to everything else written into score_summary OUTSIDE this
  // function. A recompute runs on every event, and this app's outbox makes a
  // LATE event after a match has ended entirely routine — an offline scorer
  // draining their queue. Without this, that recompute silently wiped:
  //
  //   result, winner_side          set by completeMatch when the match ends
  //   walkover, walkover_reason    set there too, for a forfeit
  //
  // Losing winner_side is not cosmetic: team insights reads it to decide W/L/D,
  // so a completed match with a clear winner would start reporting as a DRAW.
  // That is the shape of F-49, still open from the user-flow test.
  //
  // `declared` is NOT in this list and must not be: it comes from a declaration
  // EVENT and is rebuilt correctly above, so preserving it would pin a stale
  // value against a legitimate recompute.
  // A2: a knockout match's shootout is set at completion, like the result.
  for (const k of ['toss_winner_side', 'result', 'winner_side', 'walkover', 'walkover_reason', 'shootout'] as const) {
    if (existing[k] != null && summary[k] == null) summary[k] = existing[k];
  }

  return summary;
}

// Decimal cricket overs from a ball count: 7 balls → 1.1 (NUMERIC(4,1)).
function ballsToOvers(balls: number): number {
  return Math.floor(balls / 6) + (balls % 6) / 10;
}

// A5-004 · derive per-player innings_stats from the attributed event log and
// upsert them. Called at match completion (idempotent on the
// (match_id,user_id,innings_number) unique key, so re-completing is safe).
// One row per attributed player per match: their batting (in their innings)
// plus their bowling figures are combined — getSportProfile sums across rows
// for career stats, so the single-row-per-match shape aggregates correctly.
// No-ops for non-cricket and for casual matches with no attribution.
export async function writeCricketInningsStats(matchId: string): Promise<void> {
  const { data: match } = await supabase
    .from('matches').select('sport_id, team_a_id, team_b_id').eq('id', matchId).maybeSingle();
  if (!match) return;
  const { data: sportRow } = await supabase
    .from('sports').select('slug').eq('id', match.sport_id).maybeSingle();
  if ((sportRow?.slug ?? '') !== 'cricket') return;
  const { data: events } = await supabase
    .from('match_events').select('event_type, payload').eq('match_id', matchId)
    .order('created_at', { ascending: true });
  if (!events || events.length === 0) return;

  const players = aggregateCricketPlayers(events as any[]);
  const teamId = (side: 'A' | 'B'): string | null =>
    (side === 'A' ? match.team_a_id : match.team_b_id) ?? null;
  const rows = Object.entries(players)
    // Guests carry no users row — never insert a guest id into the user_id FK.
    .filter(([userId]) => !isGuestId(userId))
    .map(([userId, line]) => ({
    match_id: matchId,
    user_id: userId,
    team_id: teamId(line.side),
    innings_number: line.side === 'A' ? 1 : 2,
    runs: line.runs,
    balls_faced: line.balls,
    fours: line.fours,
    sixes: line.sixes,
    is_out: line.out,
    dismissal_type: line.dismissal ?? null,
    bowling_overs: ballsToOvers(line.bowl_balls),
    bowling_runs: line.bowl_runs,
    bowling_wickets: line.bowl_wickets,
    bowling_maidens: line.bowl_maidens,
    catches: line.catches,
    runouts: line.runouts,
    stumpings: line.stumpings,
  }));
  if (rows.length === 0) return;
  await supabase
    .from('innings_stats')
    .upsert(rows, { onConflict: 'match_id,user_id,innings_number' });
}

// POST /scoring/:matchId/undo
export async function undoEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const matchId = String(req.params.matchId);
    const auth = await authorizeScorer(matchId, userId, deviceIdOf(req));
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
    // SC-42: no edits to a finished match.
    if (isTerminalMatchStatus(auth.match.status)) {
      return res.status(409).json({ error: 'This match is finished and can no longer be edited' });
    }

    const { data: latest } = await supabase
      .from('match_events')
      .select('id')
      .eq('match_id', matchId)
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) return res.status(404).json({ error: 'No event to undo' });
    const { error } = await supabase.from('match_events').delete().eq('id', latest.id);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    // Recompute the summary from the remaining events so it can't drift out of
    // sync with the event log (the old code left score_summary stale on undo).
    try {
      await recomputeSummary(matchId);
    } catch {
      // best-effort — the event delete already succeeded
    }
    return res.json({ deleted: true });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
