import { logThenDeleteEvent, recordScoreAfter } from '../utils/scoringAudit';
import { Request, Response } from 'express';
import { checkLease } from '../utils/scoringLease';
import { deviceIdOf } from '../utils/deviceHeader';
import { isRangeError } from '../utils/pagination';
import { supabase } from '../utils/supabase';
import { pendingRankedOpponent } from '../utils/singles';
import { tennisReplayEvents, type TennisScore } from '../utils/tennisCore';
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
import { bestOfFor } from '../utils/matchLength';
import { carromReplay, carromPieces, CARROM_MAX_PIECES, CARROM_QUEEN_MAX, pointCarromReplay, pointCoinValue } from '../utils/carromCore';
import { isKnockoutBracketMatch } from '../utils/knockout';
import { allOutBySide, allowedOnFreeHit, bowlerQuotaDone, extraPenaltyOf, freeHitNext, isBallOfOver, isDismissal, penaltyRunsOf, mainEvents, superOversOf, superOverNumber } from '../utils/cricketRules';
import { typedChessBoards, typedMatchPoints, typedScoreSport, typedScoreText, typedTiePoints, type TypedSet } from '../utils/typedScore';
import { DOUBLES_PLAYERS, RALLY_TIMED, carromOptsOf, conductLadder, doublesLineupProblem, gamesWinner, ladderStepDef, rulesOf, setConfigOf, standardRules, tennisOptsOf, tieSpecOf, winsToWin, type MatchRules } from '../utils/matchRules';
import { boardPointsFor, boardWhite, splitTie, tieNeed, unitsOf, type RubberResult, type TieRubber, type TieSpec } from '../utils/tieCore';
import { trumpsFor } from '../utils/tieTrumps';
import { sideOutReplay } from '../utils/pickleballCore';
import { CRICKET_EXTRA_TYPES, isKnownWicketType } from '../utils/cricketEventTypes';
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
    .select('id, created_by, umpire_id, scorer_id, score_summary, sport_id, status, is_ranked, tournament_id, voided_at, team_a_id, team_b_id, team_a_name, team_b_name, format, overs, rules, round, group_label')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return { ok: false as const, status: 404, error: 'Match not found' };
  if (!(await canOfficiateMatch(match, userId))) {
    return { ok: false as const, status: 403, error: match.tournament_id ? 'Only a tournament organiser, the umpire or a scorer can score' : 'Only the umpire, the scorer or the creator can score' };
  }
  // SC-430: one scorer per match. Authorised is not the same as holding the pad —
  // two officiants scoring the same game do not corrupt anything, they simply BOTH
  // count, which is the quieter and worse failure. 409 so the client's outbox
  // treats it as an ordinary rejection: the queue halts, keeps every point, and
  // asks the human. See utils/scoringLease.
  const verdict = await checkLease(matchId, userId, deviceId);
  if (!verdict.ok) {
    const refusal = leaseRefusal(verdict, userId);
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

/**
 * B06-F1 · every check on ONE scoring event, shared by live scoring
 * (createEvent) and the signed QR handoff (uploadHandoff). A handoff's signature
 * only proves which phone made the bytes — the scorer controls that phone — so
 * its events are the same "buggy or crafted client" case these checks exist for.
 *
 * Returns the refusal to send, or null when the event may be recorded. Player
 * names in `payload` are cleaned in place, as before. Match-level gates (auth,
 * inactive sport, a finished match) stay with each caller.
 */
export async function validateScoringEvent(
  matchId: string,
  match: { id: string; status?: string | null; is_ranked?: boolean | null; team_a_id?: string | null; team_b_id?: string | null; team_a_name?: string | null; team_b_name?: string | null; tournament_id?: string | null; score_summary?: unknown; format?: string | null; overs?: number | null; rules?: unknown; sport_id?: string | null; round?: number | null; group_label?: string | null },
  ev: { event_type: unknown; period?: unknown; clock_seconds?: unknown; payload?: any },
): Promise<{ status: number; body: { error: string; code?: string } } | null> {
  const refuse = (status: number, body: { error: string; code?: string }) => ({ status, body });
  // BUILD 2.4 (found on the device): a tournament fixture waiting on earlier
  // results has no teams yet — a knockout final before its semis. It took
  // scoring events, so a result could exist before anyone knew who played.
  if (match.tournament_id && (!match.team_a_id || !match.team_b_id)) {
    return refuse(409, { error: 'Both teams aren’t known yet — this fixture waits on earlier results.', code: 'TEAMS_NOT_SET' });
  }
  const { event_type, period, clock_seconds, payload } = ev;
  if (!isKnownEventType(event_type)) {
    return refuse(400, { error: `Unknown event_type "${String(event_type)}".`, code: 'UNKNOWN_EVENT_TYPE' });
  }
  // B06-F6: a payload is an object or nothing. A string, number or list used to
  // skip every check below and still count as a legal ball.
  if (payload != null && (typeof payload !== 'object' || Array.isArray(payload))) {
    return refuse(400, { error: 'payload must be an object' });
  }
  // Cricket gap 9: a super over is played only when a knockout cricket match
  // ended level — and the next one only when the last was level too.
  const soNo = superOverNumber(payload);
  if (payload && 'super_over' in payload && !soNo) {
    return refuse(400, { error: 'A super over is numbered 1, 2, 3…', code: 'BAD_SUPER_OVER' });
  }
  if (soNo) {
    const slugSo = normSportSlug((await getSport(String(match.sport_id)))?.slug);
    const ss = (match.score_summary ?? {}) as { A?: { runs?: number; balls?: number; wickets?: number }; B?: { runs?: number; balls?: number; wickets?: number }; super_overs?: Array<{ done?: boolean; winner?: string | null }> };
    const batted = (x?: { balls?: number; wickets?: number }) => Number(x?.balls ?? 0) > 0 || Number(x?.wickets ?? 0) > 0;
    const level = batted(ss.A) && batted(ss.B) && Number(ss.A?.runs ?? 0) === Number(ss.B?.runs ?? 0);
    const bracket = await isKnockoutBracketMatch(match as { tournament_id: string | null; round: number | null; group_label: string | null });
    if (slugSo !== 'cricket' || !bracket || !level) {
      return refuse(409, { error: 'A super over decides only a knockout cricket match that ended level.', code: 'SUPER_OVER_NOT_ALLOWED' });
    }
    const sos = ss.super_overs ?? [];
    const last = sos[sos.length - 1];
    if (last?.done && last.winner) {
      return refuse(409, { error: 'The super over has decided the match — end it.', code: 'SUPER_OVER_DECIDED' });
    }
    if (soNo > sos.length + 1 || (soNo === sos.length + 1 && sos.length > 0 && !last?.done) || soNo < sos.length || (soNo === sos.length && last?.done)) {
      return refuse(409, { error: sos.length && !last?.done ? `Finish super over ${sos.length} first.` : 'That super over isn’t the one being played.', code: 'SUPER_OVER_OUT_OF_ORDER' });
    }
  }
  // B06-F6: cricket extras and dismissals are closed lists — an unknown one
  // counted a run or a wicket nobody can name.
  if (event_type === 'extra' && payload && payload.type != null && !CRICKET_EXTRA_TYPES.has(String(payload.type))) {
    return refuse(400, { error: 'An extra must be a wide, no-ball, bye or leg bye.', code: 'BAD_EXTRA_TYPE' });
  }
  if (event_type === 'wicket' && payload && payload.wicket_type != null && !isKnownWicketType(payload.wicket_type)) {
    return refuse(400, { error: 'That isn’t a way a batter can be out.', code: 'BAD_WICKET_TYPE' });
  }

  // SC-228: validate numeric scoring inputs so a buggy/malicious client can't
  // corrupt a score (negative subtracts, huge inflates). Clean 400, no write.
  // Bounds by family: point/board `value` 1..3 (basketball 3-pointer, carrom
  // queen 3, rally 1); cricket `runs` 0..7 (dot ball .. six + overthrow buffer);
  // `period`/set/ply 0..2000; `clock_seconds` 0..86400 (≤24h). team_side A|B.
  const outOfRange = (v: unknown, min: number, max: number): boolean =>
    v != null && (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max);
  if (outOfRange(period, 0, 2000)) {
    return refuse(400, { error: 'period must be an integer between 0 and 2000' });
  }
  if (outOfRange(clock_seconds, 0, 86400)) {
    return refuse(400, { error: 'clock_seconds must be an integer between 0 and 86400' });
  }
  if (payload && typeof payload === 'object') {
    if (payload.team_side != null && payload.team_side !== 'A' && payload.team_side !== 'B') {
      return refuse(400, { error: 'team_side must be "A" or "B"' });
    }
    // A5: a carrom BOARD result carries what the board was worth (pieces left
    // 0–9, +3 queen) — the only score event worth more than 3 (or 0).
    const isBoard = payload.kind === 'board';
    if (isBoard) {
      if (outOfRange(payload.pieces_left, 0, CARROM_MAX_PIECES)) {
        return refuse(400, { error: `pieces_left must be an integer between 0 and ${CARROM_MAX_PIECES}` });
      }
      if (payload.queen != null && typeof payload.queen !== 'boolean') {
        return refuse(400, { error: 'queen must be true or false' });
      }
      // BUILD 3.72: a queen can be worth up to 5 (the home game); the score is recomputed anyway.
      if (outOfRange(payload.value, 0, CARROM_MAX_PIECES + CARROM_QUEEN_MAX)) {
        return refuse(400, { error: 'value is out of range for a board' });
      }
    } else if (payload.kind === 'coin') {
      // BUILD 3.77: point carrom — one piece, worth its colour; only in a point-carrom match.
      const slug = match.sport_id ? normSportSlug((await getSport(match.sport_id))?.slug) : '';
      const r = slug === 'carrom' ? rulesOf(slug, match) : null;
      if (!r || r.carromMode !== 'points') return refuse(400, { error: 'A piece is scored only in point carrom.', code: 'BAD_COIN' });
      if (payload.coin !== 'white' && payload.coin !== 'black' && payload.coin !== 'queen') return refuse(400, { error: 'A piece is white, black or the queen.', code: 'BAD_COIN' });
      if (payload.value != null && Number(payload.value) !== pointCoinValue(payload.coin, r.queenValue ?? 50)) {
        return refuse(400, { error: 'That piece isn’t worth that.', code: 'BAD_COIN' });
      }
    } else if (outOfRange(payload.value, 1, 3)) {
      return refuse(400, { error: 'value must be an integer between 1 and 3' });
    }
    // BUILD 3.14: a roof penalty (box cricket) rides on a ball: −10..−1.
    if (payload.penalty_runs !== undefined) {
      if (event_type !== 'ball' || penaltyRunsOf(payload) === 0) {
        return refuse(400, { error: 'penalty_runs is a whole number from -10 to -1, on a ball.', code: 'BAD_PENALTY_RUNS' });
      }
      if (rulesOf('cricket', match).style !== 'box') {
        return refuse(400, { error: 'Roof penalties are for box cricket.', code: 'BAD_PENALTY_RUNS' });
      }
    }
    // BUILD 3.6: a wide / no-ball worth 2 makes a no-ball six 8.
    const wideOrNb = event_type === 'extra' && (payload.type === 'Wd' || payload.type === 'Nb');
    const maxRuns = 7 + (wideOrNb ? Math.max(0, extraPenaltyOf(payload) - 1) : 0);
    if (outOfRange(payload.runs, 0, maxRuns)) {
      return refuse(400, { error: `runs must be an integer between 0 and ${maxRuns}` });
    }
    // BUILD 3.6: a wide / no-ball carries the match's penalty. An older app
    // sends none and adds 1 — right only where a wide is worth 1, so it can't
    // score a match that counts them otherwise.
    if (wideOrNb) {
      const want = rulesOf('cricket', match).extraRuns ?? 1;
      // BUILD 3.7: where wides / no-balls aren't bowled again the app marks
      // each one `rebowl: false` (a ball of the over); an older app can't.
      const rebowl = rulesOf('cricket', match).rebowl !== false;
      if (payload.penalty === undefined && !rebowl) {
        return refuse(409, {
          error: 'This match counts a wide or no-ball as a ball of the over. Update SportClan to score it.',
          code: 'EXTRA_RUNS_UPDATE_APP',
        });
      }
      if (payload.penalty !== undefined && (payload.rebowl === false) === rebowl) {
        return refuse(400, {
          error: rebowl ? 'A wide or no-ball is bowled again in this match.' : 'A wide or no-ball counts as a ball of the over in this match.',
          code: 'BAD_REBOWL',
        });
      }
      if (payload.penalty === undefined) {
        if (want !== 1) {
          return refuse(409, {
            error: `This match counts a wide or no-ball as ${want} run${want === 1 ? '' : 's'}. Update SportClan to score it.`,
            code: 'EXTRA_RUNS_UPDATE_APP',
          });
        }
      } else if (payload.penalty !== want) {
        return refuse(400, { error: `A wide or no-ball is worth ${want} run${want === 1 ? '' : 's'} in this match.`, code: 'BAD_PENALTY' });
      } else if (typeof payload.runs === 'number' && payload.runs < want) {
        return refuse(400, { error: `A wide or no-ball here is at least ${want} run${want === 1 ? '' : 's'}.`, code: 'BAD_PENALTY' });
      }
    }
  }

  // BUILD 3.32: a first-to basketball game is over once a side reaches the
  // target — a basket after it is refused (the app closes its pad there too).
  if (event_type === 'score' && payload && typeof payload === 'object' && /^[123]pt$/.test(String(payload.kind ?? ''))) {
    // BUILD 3.33: 3x3 scores 1s and 2s — no 3.
    if (rulesOf('basketball', match).pointSet === '12' && Number(payload.value) === 3) {
      return refuse(400, { error: 'This game scores 1s and 2s (3x3) — there’s no 3.', code: 'BAD_POINTS' });
    }
    const target = rulesOf('basketball', match).targetScore;
    const ss = (match.score_summary ?? {}) as { A?: { score?: number; points?: number }; B?: { score?: number; points?: number } };
    const pts = (x?: { score?: number; points?: number }) => Number(x?.score ?? x?.points ?? 0);
    if (target && (pts(ss.A) >= target || pts(ss.B) >= target)) {
      return refuse(409, { error: `A side has reached ${target} — the game is over. End the match.`, code: 'TARGET_REACHED' });
    }
  }

  // Phase 3 · decision 2: a RANKED singles match cannot start until the
  // opponent has accepted. Checked only before the first point (status still
  // scheduled) — once it is live, it was accepted. 409 so the scorer's outbox
  // halts and asks rather than dropping the point.
  // V-3: a serve swap before the first rally is a pre-match setting (the
  // toss), not play — it neither starts the match nor needs the opponent's yes.
  if (event_type !== 'serve_swap' && match.status === 'scheduled') {
    const gate = await pendingRankedOpponent(match);
    if (gate.pending) {
      return refuse(409, {
        error: `${gate.opponentName ?? 'Your opponent'} hasn't accepted this ranked match yet. It can start once they do.`,
        code: 'OPPONENT_NOT_ACCEPTED',
      });
    }
  }

  // BUILD 3.58: a side-out 'rally' event only in a side-out pickleball match —
  // in any other it would score as a point (the rollups count every score).
  if (event_type === 'score' && payload && payload.kind === 'rally') {
    const slug = match.sport_id ? normSportSlug((await getSport(match.sport_id))?.slug) : '';
    if (slug !== 'pickleball' || rulesOf(slug, match).scoring !== 'sideout') {
      return refuse(400, { error: 'A rally without a point is for side-out pickleball.', code: 'BAD_RALLY' });
    }
  }
  // A side-out match takes rallies, not points (a point would bypass the serve) —
  // Stage 9 · T9: except a penalty point (a technical foul), which is one.
  if (event_type === 'score' && payload && payload.kind !== 'rally' && payload.kind !== 'penalty' && match.sport_id) {
    const slug = normSportSlug((await getSport(match.sport_id))?.slug);
    if (slug === 'pickleball' && rulesOf(slug, match).scoring === 'sideout') {
      return refuse(409, { error: 'This match uses side-out scoring — update SportClan to score it.', code: 'SIDEOUT_NEEDS_UPDATE' });
    }
  }

  // BUILD 3.66: time called at the buzzer — a timed tennis match only.
  if (event_type === 'note' && payload && payload.kind === 'buzzer') {
    const slug = match.sport_id ? normSportSlug((await getSport(match.sport_id))?.slug) : '';
    // BUILD 3.76: and a timed carrom game.
    // Stage 11 · PB9: and a timed badminton, table tennis, pickleball or volleyball match.
    const timedHere = slug === 'tennis' || RALLY_TIMED.has(slug) ? !!rulesOf(slug, match).timeLimitMinutes : slug === 'carrom' ? !!rulesOf(slug, match).gameMinutes : false;
    if (!timedHere) {
      return refuse(400, { error: 'Time is called only in a timed match (or a timed carrom game).', code: 'BAD_NOTE' });
    }
  }
  // Stage 11 · PB6: a point off the offender, or the game forfeited — a step of
  // this match's conduct ladder, in a sport scored in games (rally sports).
  if (event_type === 'note' && payload && (payload.kind === 'point_off' || payload.kind === 'game_forfeit')) {
    const slug = match.sport_id ? normSportSlug((await getSport(match.sport_id))?.slug) : '';
    const effect = payload.kind === 'point_off' ? 'point_off' : 'forfeit_game';
    const onLadder = conductLadder(slug, rulesOf(slug, match)).some((k) => ladderStepDef(slug, k).effect === effect);
    if (!SET_CONFIG[slug] || !onLadder) {
      return refuse(400, { error: payload.kind === 'point_off' ? 'A point off isn’t a penalty in this match.' : 'Forfeiting a game isn’t a penalty in this match.', code: 'BAD_NOTE' });
    }
    if (payload.team_side !== 'A' && payload.team_side !== 'B') return refuse(400, { error: 'Say whose penalty it is.', code: 'BAD_NOTE' });
  }
  // BUILD 3.53: table tennis's expedite rule — table tennis only, and never
  // once both players have 9 points in the game (ITTF 2.15.1).
  if (event_type === 'note' && payload && payload.kind === 'expedite') {
    const slug = match.sport_id ? normSportSlug((await getSport(match.sport_id))?.slug) : '';
    if (slug !== 'tabletennis') return refuse(400, { error: 'The expedite rule is for table tennis.', code: 'BAD_NOTE' });
    const ss = (match.score_summary ?? {}) as { A?: { points?: number }; B?: { points?: number } };
    if (Number(ss.A?.points ?? 0) >= 9 && Number(ss.B?.points ?? 0) >= 9) {
      return refuse(409, { error: 'The expedite rule can’t come in once both players have 9 points.', code: 'EXPEDITE_TOO_LATE' });
    }
  }

  // BUILD 3.47: badminton doubles is two a side — play can't start with a side
  // of one (a typed-in side, with no players listed, is fine). Checked before
  // the first point only, like the ranked gate above.
  if (event_type !== 'serve_swap' && match.status === 'scheduled' && match.sport_id) {
    const slug = normSportSlug((await getSport(match.sport_id))?.slug);
    const rules = rulesOf(slug, match);
    if (slug === 'badminton' && rules.players === DOUBLES_PLAYERS) {
      const { data: parts } = await supabase.from('match_participants').select('team_side').eq('match_id', matchId);
      const rows = (parts ?? []) as Array<{ team_side?: string | null }>;
      const problem = doublesLineupProblem(slug, rules,
        { A: rows.filter((r) => r.team_side === 'A').length, B: rows.filter((r) => r.team_side === 'B').length },
        { A: match.team_a_name ?? 'Team A', B: match.team_b_name ?? 'Team B' }, 'start');
      if (problem) return refuse(409, { error: problem, code: 'DOUBLES_TWO_A_SIDE' });
    }
  }

  // A3: a chess result's reason must be one of the shared list (chessRules —
  // the same list the app offers, incl. insufficient material / 50-move rule).
  if (event_type === 'result' && payload && typeof payload === 'object'
    && (payload.winner === 'white' || payload.winner === 'black' || payload.winner === 'draw')
    && !isValidChessReason(payload.winner, payload.reason)) {
    return refuse(400, { error: 'That isn’t a way this result can happen.', code: 'BAD_CHESS_REASON' });
  }

  // F-05 (confirmed live, session 1): a chess result names the player who won.
  // The app sent the WHITE player's id for "Black wins" (it always dispatched
  // results as side A), so the loser was credited and became Player of the
  // Match. A registered player named on a result must be on the winning side.
  if (event_type === 'result' && payload && typeof payload === 'object'
    && (payload.winner === 'white' || payload.winner === 'black')
    && typeof payload.player_id === 'string' && !isGuestId(payload.player_id)) {
    // Stage 12 · CH5: on a team chess board the winning team is named (its colour depends on the board).
    const wantSide = payload.team_side === 'A' || payload.team_side === 'B' ? payload.team_side : payload.winner === 'white' ? 'A' : 'B';
    const { data: part } = await supabase
      .from('match_participants').select('team_side')
      .eq('match_id', matchId).eq('user_id', payload.player_id).maybeSingle();
    if (part && (part as { team_side?: string }).team_side !== wantSide) {
      return refuse(400, {
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
      return refuse(400, { error: 'Ranked matches require registered players, not guests.' });
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
      return refuse(400, {
        error: 'The batter and the bowler cannot be the same player.',
        code: 'SAME_PLAYER_BOTH_ROLES',
      });
    }

    // BUILD 3.8: off a free hit the batter is out only as off a no-ball (run
    // out, obstructing, hit twice). Read from the log — only when the match
    // plays free hits and the wicket is one a free hit rules out.
    if (event_type === 'wicket' && payload.is_extra !== true && !allowedOnFreeHit(payload.wicket_type ?? payload.type)
      && rulesOf('cricket', match).freeHit) {
      const { data: log } = await supabase
        .from('match_events').select('event_type, payload')
        .eq('match_id', matchId).order('created_at', { ascending: true });
      // Gap 9: within the same innings — the match's own, or this super over's.
      const sameInnings = (log ?? []).filter((e: { payload?: unknown }) => superOverNumber(e.payload) === superOverNumber(payload));
      if (freeHitNext(sameInnings as never, payload.team_side === 'B' ? 'B' : 'A')) {
        return refuse(400, {
          error: 'It’s a free hit — the batter can only be run out (or out obstructing the field or hitting the ball twice).',
          code: 'FREE_HIT',
        });
      }
    }

    // Cricket gap 1 (5 Oct 2026): a match played without LBW (tennis-ball and
    // box cricket) refuses an LBW. Older apps still show the button; this keeps
    // the scorecard to the match's rules.
    if (event_type === 'wicket' && String(payload.wicket_type ?? payload.type ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'lbw'
      && rulesOf('cricket', match).noLbw) {
      return refuse(400, { error: 'This match is played without LBW — it isn’t a way out here.', code: 'NO_LBW' });
    }

    // BUILD 3.5: a bowler who has bowled the match's max overs can't bowl
    // again. A delivery of theirs — a ball, a wide, a no-ball, a bye — is
    // refused; a wicket off no ball (a run-out on a wide, a retirement) is not
    // their delivery and goes through. The summary's rollup counts their balls.
    const isDelivery = event_type === 'ball' || event_type === 'extra' || (event_type === 'wicket' && payload.is_extra !== true);
    // Gap 9: the match's quota doesn't stop anyone bowling a super over.
    if (bowlId && isDelivery && !superOverNumber(payload)) {
      const limit = rulesOf('cricket', match).bowlerOvers;
      const bowled = (match.score_summary as { players?: Record<string, { bowl_balls?: number }> } | null)?.players?.[bowlId]?.bowl_balls;
      if (bowlerQuotaDone(bowled, limit)) {
        return refuse(409, {
          error: `This bowler has bowled their ${limit} over${limit === 1 ? '' : 's'} — the most one bowler may bowl in this match.`,
          code: 'BOWLER_QUOTA_DONE',
        });
      }
    }
  }

  return null;
}

/**
 * A scheduled match goes live on its first accepted play (never a downgrade of
 * a finished one). Shared with the QR handoff, which used to leave a first-play
 * match on `scheduled` (B06-F1).
 */
export async function promoteToLive(matchId: string, match: { status?: string | null }): Promise<void> {
  if (match.status !== 'scheduled') return;
  try {
    await supabase.from('matches').update({ status: 'live' }).eq('id', matchId).eq('status', 'scheduled');
  } catch {
    // best-effort — don't block scoring on the status flip
  }
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
      // B06-F5: a code, so the scorer's outbox can tell "ended elsewhere" from
      // any other refusal and stop offering a retry that can never succeed.
      return res.status(409).json({ error: 'This match is finished and can no longer be scored', code: 'MATCH_FINISHED' });
    }

    // B06-F1: every check on the event itself lives in validateScoringEvent, so
    // the signed QR handoff (qrHandoff.controller) runs exactly the same ones.
    const refused = await validateScoringEvent(matchId, match, { event_type, period, clock_seconds, payload });
    if (refused) return res.status(refused.status).json(refused.body);
    const startsPlay = event_type !== 'serve_swap';

    // Catch-all: any scored event means the match is in progress, so promote it
    // to `live`. The toss handler already does this for the normal flow; this
    // covers the "skip toss" path where scoring starts without a recorded toss.
    // Guard so we never downgrade a completed/cancelled match.
    // F-24: only once every check above has passed — a REFUSED event (a chess
    // result with a bad reason or the wrong player, a guest in a ranked match,
    // one player batting and bowling) used to start the match anyway.
    if (startsPlay) await promoteToLive(matchId, match);

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
          // BUILD 3.4: retired at the match's limit — not hurt, not out.
          const atLimit = String(payload?.wicket_type ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'retirednotout';
          const title = atLimit ? 'Retired' : hurt ? 'Retired hurt' : 'Wicket!';
          const verb = atLimit ? 'retired not out on' : hurt ? 'retired hurt on' : 'out for';
          const body =
            runs !== ''
              ? `${playerName} ${verb} ${runs} | ${teamName(side)} ${scoreStr}`
              : `${playerName} ${atLimit ? 'retired not out' : hurt ? 'retired hurt' : 'out'} | ${teamName(side)} ${scoreStr}`;
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
            regulation: rulesOf('basketball', match).periods ?? null, // BUILD 3.30
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
    const { since, limit, offset } = req.query as Record<string, unknown>;
    // B06-F7: a bad limit or since went straight to PostgREST and came back a 500.
    const n = typeof limit === 'string' && /^\d+$/.test(limit) ? parseInt(limit, 10) : 0;
    const off = typeof offset === 'string' && /^\d+$/.test(offset) ? Math.min(parseInt(offset, 10), 10_000_000) : 0;
    if (since != null && (typeof since !== 'string' || Number.isNaN(Date.parse(since)))) {
      return res.status(400).json({ error: 'since must be a date' });
    }
    // Oct 2026 sweep: the app read one answer (500 events, no "more") and
    // replayed it as the whole match — a 50-over game has more. Pages now have
    // a stable order (created_at, then id: an offline batch shares one
    // timestamp), an offset, and has_more.
    const size = n >= 1 ? Math.min(n, 1000) : 500;
    let query = supabase
      .from('match_events')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(off, off + size); // one extra row says whether there is more
    if (since) query = query.gt('created_at', since);
    const { data, error } = await query;
    if (error && !isRangeError(error)) return res.status(500).json({ error: sanitizeError(error) });
    const rows = data || [];
    return res.json({ events: rows.slice(0, size), has_more: rows.length > size, next_offset: off + Math.min(rows.length, size) });
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
> = Object.fromEntries(
  // BUILD 2.3: the standards live in the shared matchRules (the app's rally
  // engine reads the same file); this is only their standard-rules view.
  // Tennis is NOT here (T-1): it scores POINTS, through tennisCore.
  ['badminton', 'tabletennis', 'pickleball', 'volleyball', 'carrom'].map((sport) => [sport, setConfigOf(standardRules(sport))]),
);

/**
 * F-01 (confirmed live, session 1): for the best-of sports, how many sets/games/
 * boards win the match, and whether a canonical summary says someone has.
 * Null for sports that are not best-of (goals, points, runs, chess).
 */
export function bestOfState(
  slug: string,
  summary: Record<string, any> | null | undefined,
  match?: { format?: string | null; overs?: number | null; rules?: unknown } | string | null,
): { needed: number; decided: boolean; scored: boolean; leader: 'A' | 'B' | null } | null {
  // Decision B / BUILD 2.3: the match's own length — its rules (matchRules,
  // shared with the app), or for an older caller just its format.
  if (bestOfFor(slug, null) === null) return null;
  const m = typeof match === 'string' || match == null ? { format: match ?? null } : match;
  const needed = winsToWin(rulesOf(slug, m));
  const a = Number(summary?.A?.score ?? 0);
  const b = Number(summary?.B?.score ?? 0);
  // BUILD 3.66: a timed tennis match after the buzzer goes to the leader — on
  // sets, then games in the set in play, then points in the game in play.
  // Stage 11 · PB9: a timed rally match that ended level at the buzzer is decided — a draw.
  if (summary?.timed_level === true) return { needed, decided: true, scored: true, leader: null };
  if (summary?.buzzer === true) {
    const cmp = (x: unknown, y: unknown) => Number(x ?? 0) - Number(y ?? 0);
    const d = cmp(a, b) || cmp(summary?.A?.games, summary?.B?.games) || cmp(summary?.A?.points, summary?.B?.points);
    return { needed, decided: d !== 0, scored: true, leader: d > 0 ? 'A' : d < 0 ? 'B' : null };
  }
  // Stage 9 · T3: a team tie says itself whether it's decided (its win rule; a draw has no leader).
  if (summary?.tie && typeof summary.tie === 'object') {
    const t = summary.tie as { decided?: 'A' | 'B' | 'draw' | null; rubbersA?: number; rubbersB?: number };
    const spec = tieSpecOf(slug, rulesOf(slug, m));
    const need = spec ? (spec.win === 'first' ? tieNeed(spec) : spec.rubbers.length) : needed;
    return { needed: need, decided: t.decided != null, scored: true, leader: t.decided === 'A' || t.decided === 'B' ? t.decided : null };
  }
  const scored = a + b > 0
    || (summary?.A?.sets?.length ?? 0) > 0 || (summary?.B?.sets?.length ?? 0) > 0
    || Number(summary?.A?.points ?? 0) + Number(summary?.B?.points ?? 0) > 0
    || Number(summary?.A?.games ?? 0) + Number(summary?.B?.games ?? 0) > 0;
  // Stage 10 · TT5: every game played — decided once all are played.
  const r = rulesOf(slug, m) as MatchRules;
  if (r.allGames) return { needed: r.bestOf ?? needed, decided: gamesWinner(a, b, r.bestOf ?? 3, true) != null, scored, leader: a > b ? 'A' : b > a ? 'B' : null };
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
  cfg: { target: number; cap?: number; maxSets: number; finalTarget?: number; winBy2: boolean; allGames?: boolean },
  events: { event_type: string; payload: any }[],
  sideOf: (p: any) => 'A' | 'B',
  /** Stage 11 · PB9: a timed match — what a level score at the buzzer does. */
  timed: { level: 'next_point' | 'draw' } | null = null,
): { setsA: number; setsB: number; setScoresA: number[]; setScoresB: number[]; curA: number; curB: number; decided: 'A' | 'B' | null; buzzer?: boolean; level?: boolean } {
  const need = Math.ceil(cfg.maxSets / 2);
  let curA = 0, curB = 0, setsA = 0, setsB = 0, period = 1;
  let decided: 'A' | 'B' | null = null;
  let buzzer = false; let level = false;
  const setScoresA: number[] = [], setScoresB: number[] = [];
  // Stage 11 · PB9: at the buzzer (or the first point after a level buzzer) the
  // side ahead — on games, then on points in the game in play — wins; the game
  // in play is recorded, and counts for its leader when games were level.
  const leader = (): 'A' | 'B' | null => (setsA !== setsB ? (setsA > setsB ? 'A' : 'B') : curA !== curB ? (curA > curB ? 'A' : 'B') : null);
  const endAtTime = (w: 'A' | 'B' | null) => {
    if (curA + curB > 0) {
      const wasLevel = setsA === setsB;
      setScoresA.push(curA); setScoresB.push(curB);
      if (wasLevel && w === 'A') setsA += 1; else if (wasLevel && w === 'B') setsB += 1;
      curA = 0; curB = 0;
    }
    if (w) decided = w; else level = true;
  };
  for (const e of events) {
    if (decided || level) break;
    const p: any = e.payload || {};
    if (timed && e.event_type === 'note' && p.kind === 'buzzer') {
      if (buzzer) continue;
      buzzer = true;
      const l = leader();
      if (l) endAtTime(l); else if (timed.level === 'draw') endAtTime(null);
      continue;
    }
    const target = cfg.finalTarget && period === cfg.maxSets ? cfg.finalTarget : cfg.target;
    // Stage 11 · PB6: a technical foul takes a point off the offender; a
    // forfeited game goes to the other side at its target to 0 (11-0).
    if (e.event_type === 'note' && p.kind === 'point_off') {
      if (sideOf(p) === 'A') curA = Math.max(0, curA - 1); else curB = Math.max(0, curB - 1);
      continue;
    }
    if (e.event_type === 'note' && p.kind === 'game_forfeit') {
      if (sideOf(p) === 'A') { curA = 0; curB = target; } else { curB = 0; curA = target; }
    } else {
      if (e.event_type !== 'score') continue;
      // Rally points are 1; carrom pieces/queen carry value (1 or 3).
      const v = Number(p.value ?? 1);
      if (sideOf(p) === 'A') curA += v; else curB += v;
    }
    const w = setWon(curA, curB, target, cfg.cap, cfg.winBy2);
    if (w) {
      setScoresA.push(curA); setScoresB.push(curB);
      if (w === 'A') setsA += 1; else setsB += 1;
      curA = 0; curB = 0; period += 1;
      void need;
      decided = gamesWinner(setsA, setsB, cfg.maxSets, cfg.allGames); // Stage 10 · TT5: or every game played
    }
    if (buzzer && !decided) { const l = leader(); if (l) endAtTime(l); } // Stage 11 · PB9: the next point after a level buzzer
  }
  return { setsA, setsB, setScoresA, setScoresB, curA, curB, decided, ...(buzzer ? { buzzer: true } : {}), ...(level ? { level: true } : {}) };
}

/**
 * Stage 9 · T3 · a team tie, any tie sport (tennis, badminton, table tennis,
 * pickleball): the shared tieCore splits the events into the organiser's
 * rubbers, each read by the sport's own engine — tennis's tennisCore, side-out
 * pickleball's pickleballCore, the rally sports' set rollup. A rubber's A/B is
 * the sets (tennis) or games (rally) it was won by, as before; its units are its
 * games (tennis) or points (rally). The score is rubbers won — or, in a tie won
 * on games, the games / points.
 */
export function rollupTieSpec(
  slug: string, rules: MatchRules, spec: TieSpec,
  events: { event_type: string; payload: any }[], sideOf: (p: any) => 'A' | 'B',
): { scoreA: number; scoreB: number; setsA: number[]; setsB: number[]; gamesA: number; gamesB: number; curA: number; curB: number; rubber: number; results: Array<{ A: number; B: number; winner: 'A' | 'B' | 'draw'; key: string; label: string; unitsA: number; unitsB: number }>; tie: { win: string; rubbersA: number; rubbersB: number; unitsA: number; unitsB: number; decided: 'A' | 'B' | 'draw' | null; decider?: boolean }; finished: RubberResult[]; ends: number[] } {
  const own = !!rules.tie;
  const single = { ...rules, tie: null, rubbers: null } as MatchRules;
  // Stage 11 · PB3: a match with its own rules (the DreamBreaker) plays those over the tie's.
  const rulesFor = (r: TieRubber) => (own ? { ...single, ...((r.rules ?? {}) as Partial<MatchRules>), players: r.players === 2 ? DOUBLES_PLAYERS : null, tie: null, rubbers: null } : single) as MatchRules;
  type Read = { winner: 'A' | 'B' | 'draw' | null; sets: { A: number[]; B: number[] }; games: { A: number; B: number }; points: { A: number; B: number } };
  const read = (evs: { event_type: string; payload: any }[], r: TieRubber): Read => {
    const rr = rulesFor(r);
    // Stage 12 · CH5: a board of a team chess match — its result, by its colours, worth the board's points.
    if (slug === 'chess') {
      let w: 'white' | 'black' | 'draw' | undefined;
      for (const e of evs) if (e.event_type === 'result') w = e.payload?.winner;
      if (!w) return { winner: null, sets: { A: [], B: [] }, games: { A: 0, B: 0 }, points: { A: 0, B: 0 } };
      const white = boardWhite(spec, Math.max(0, spec.rubbers.indexOf(r)));
      const bp = boardPointsFor(spec, w);
      const a = white === 'A' ? bp.white : bp.black; const b = white === 'A' ? bp.black : bp.white;
      const winner: 'A' | 'B' | 'draw' = w === 'draw' ? 'draw' : w === 'white' ? white : (white === 'A' ? 'B' : 'A');
      return { winner, sets: { A: [a], B: [b] }, games: { A: 0, B: 0 }, points: { A: 0, B: 0 } };
    }
    // Stage 12 · CH5: a carrom match in a team event — the shared carromCore, as a single match.
    if (slug === 'carrom') {
      if (rr.carromMode === 'points') {
        const pc = pointCarromReplay(evs.filter((e) => e.event_type === 'score' && e.payload?.kind === 'coin').map((e) => ({ side: sideOf(e.payload || {}), coin: e.payload.coin })).filter((x) => x.coin === 'white' || x.coin === 'black' || x.coin === 'queen'),
          { gamesToWin: winsToWin(rr), queenValue: rr.queenValue ?? 50 });
        const done = pc.gamesWon.A >= winsToWin(rr) ? 'A' : pc.gamesWon.B >= winsToWin(rr) ? 'B' : null;
        return { winner: done, sets: { A: pc.games.map((g) => g.A), B: pc.games.map((g) => g.B) }, games: pc.gamesWon, points: pc.points };
      }
      const c = carromReplay(evs.filter((e) => e.event_type === 'score' && e.payload?.kind === 'board').map((e) => ({ winner: sideOf(e.payload || {}), piecesLeft: carromPieces(e.payload.pieces_left), queen: e.payload.queen === true })), carromOptsOf(rr));
      return { winner: c.winner ?? null, sets: { A: c.games.map((g) => g.A), B: c.games.map((g) => g.B) }, games: c.gamesWon, points: c.points };
    }
    if (slug === 'tennis') {
      const tr = tennisReplayEvents(evs.map((e) => ({ event_type: e.event_type, payload: { ...(e.payload || {}), team_side: sideOf(e.payload || {}) } })), tennisOptsOf(rr));
      const t = tr.score;
      return { winner: t.winner, sets: { A: t.sets.map((x) => x.A), B: t.sets.map((x) => x.B) }, games: t.games, points: t.points };
    }
    const cfg = setConfigOf(rr);
    // Stage 11 · PB9: a timed match inside a tie can end level ('draw').
    if (slug === 'pickleball' && rr.scoring === 'sideout') {
      const sx = sideOutReplay(evs.filter((e) => rr.timeLimitMinutes || !(e.event_type === 'note' && e.payload?.kind === 'buzzer')), { target: cfg.target, winBy2: cfg.winBy2, maxGames: cfg.maxSets, doubles: rr.players === DOUBLES_PLAYERS, ...(cfg.allGames ? { allGames: true } : {}), ...(rr.timeLimitMinutes ? { timedLevel: rr.timedLevel ?? 'next_point' } : {}) });
      return { winner: sx.level ? 'draw' : sx.winner, sets: { A: sx.games.map((g) => g.A), B: sx.games.map((g) => g.B) }, games: sx.won, points: sx.cur };
    }
    const x = rollupSets(cfg, evs, sideOf, rr.timeLimitMinutes ? { level: rr.timedLevel === 'draw' ? 'draw' : 'next_point' } : null);
    return { winner: x.level ? 'draw' : x.decided, sets: { A: x.setScoresA, B: x.setScoresB }, games: { A: x.setsA, B: x.setsB }, points: { A: x.curA, B: x.curB } };
  };
  const split = splitTie(events, spec, (evs, r) => {
    const x = read(evs, r);
    return { winner: x.winner, sets: x.sets, units: { A: unitsOf(x.sets.A), B: unitsOf(x.sets.B) } };
  });
  const o = split.outcome;
  const cur = o.finished ? null : read(split.currentEvents, spec.rubbers[split.current] ?? spec.rubbers[0]!);
  const won = (a: number[], b: number[]) => a.filter((v, i) => v > (b[i] ?? 0)).length;
  return {
    scoreA: spec.win === 'games' ? o.unitsA : o.rubbersA, scoreB: spec.win === 'games' ? o.unitsB : o.rubbersB,
    setsA: [...split.results.flatMap((r) => r.sets.A), ...(cur ? cur.sets.A : [])], setsB: [...split.results.flatMap((r) => r.sets.B), ...(cur ? cur.sets.B : [])],
    gamesA: cur?.games.A ?? 0, gamesB: cur?.games.B ?? 0, curA: cur?.points.A ?? 0, curB: cur?.points.B ?? 0,
    rubber: o.finished ? split.results.length : split.results.length + 1,
    results: split.results.map((r, i) => ({ A: won(r.sets.A, r.sets.B), B: won(r.sets.B, r.sets.A), winner: r.winner, key: r.key, label: spec.rubbers[i]?.label ?? r.key, unitsA: r.units.A, unitsB: r.units.B })),
    tie: { win: spec.win, rubbersA: o.rubbersA, rubbersB: o.rubbersB, unitsA: o.unitsA, unitsB: o.unitsB, decided: o.decided, ...(o.decider ? { decider: true } : {}) }, // Stage 11 · PB3: won in the deciding match
    // 2.14: each finished match as the engine read it, and the event that ended it (the timeline's trump lines).
    finished: split.results, ends: split.ends,
  };
}

/**
 * BUILD 3.49 · a badminton team tie: rubbers of `cfg.maxSets` games each, the
 * tie to whoever wins floor(rubbers/2)+1 of them (no dead rubbers). The app's
 * tie ruleset (scoring/rules/_tie) splits the same events the same way.
 * `setScores` are every game played, in order, across the rubbers.
 */
export function rollupTie(
  cfg: { target: number; cap?: number; maxSets: number; finalTarget?: number; winBy2: boolean; allGames?: boolean },
  rubbers: number,
  events: { event_type: string; payload: any }[],
  sideOf: (p: any) => 'A' | 'B',
): { rubbersA: number; rubbersB: number; results: Array<{ A: number; B: number; winner: 'A' | 'B' }>; rubber: number; gamesA: number; gamesB: number; setScoresA: number[]; setScoresB: number[]; curA: number; curB: number; decided: 'A' | 'B' | null } {
  const needGames = Math.ceil(cfg.maxSets / 2);
  const needRubbers = Math.floor(rubbers / 2) + 1;
  let curA = 0, curB = 0, gamesA = 0, gamesB = 0, period = 1, rubbersA = 0, rubbersB = 0;
  let decided: 'A' | 'B' | null = null;
  const setScoresA: number[] = [], setScoresB: number[] = [];
  const results: Array<{ A: number; B: number; winner: 'A' | 'B' }> = [];
  for (const e of events) {
    if (decided) break;
    if (e.event_type !== 'score') continue;
    const p: any = e.payload || {};
    if (sideOf(p) === 'A') curA += 1; else curB += 1;
    const target = cfg.finalTarget && period === cfg.maxSets ? cfg.finalTarget : cfg.target;
    const w = setWon(curA, curB, target, cfg.cap, cfg.winBy2);
    if (!w) continue;
    setScoresA.push(curA); setScoresB.push(curB);
    if (w === 'A') gamesA += 1; else gamesB += 1;
    curA = 0; curB = 0; period += 1;
    void needGames;
    const rw = gamesWinner(gamesA, gamesB, cfg.maxSets, cfg.allGames); // Stage 10 · TT5
    if (!rw) continue;
    results.push({ A: gamesA, B: gamesB, winner: rw });
    if (rw === 'A') rubbersA += 1; else rubbersB += 1;
    gamesA = 0; gamesB = 0; period = 1;
    if (rubbersA >= needRubbers) decided = 'A';
    else if (rubbersB >= needRubbers) decided = 'B';
  }
  return { rubbersA, rubbersB, results, rubber: decided ? results.length : results.length + 1, gamesA, gamesB, setScoresA, setScoresB, curA, curB, decided };
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
    if (b && !b.out && (b.dismissal === 'retired_hurt' || b.dismissal === 'retired_not_out')) delete b.dismissal;
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
    if (e.event_type === 'ball') delivery(batSide, bowlId, isBallOfOver('ball', p), Number(p.runs ?? 0));
    else if (e.event_type === 'extra') {
      const legalExtra = isBallOfOver('extra', p);
      delivery(batSide, bowlId, legalExtra, p.type === 'B' || p.type === 'Lb' ? 0 : Number(p.runs ?? 0));
    } else if (e.event_type === 'wicket' && isBallOfOver('wicket', p)) delivery(batSide, bowlId, true, 0);
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
      const legal = isBallOfOver('extra', p); // byes/leg-byes are legal balls
      const bye = p.type === 'B' || p.type === 'Lb';
      if (batId && bye) ensure(batId, batSide, batName).balls += 1; // ball faced, runs are extras (not the batter's)
      // Decision 2026-09-26 (MATCH_CREATE_TEST_5): runs on a no-ball are off the
      // bat. Stored runs include the 1-run penalty, so NB + N gives the striker N
      // and a ball faced; the bowler is still charged all of it (below), and it is
      // still no ball of the over. The app's utils/cricketCredit is the same rule.
      if (batId && p.type === 'Nb') {
        const b = ensure(batId, batSide, batName);
        const offBat = Math.max(0, runs - extraPenaltyOf(p)); // BUILD 3.6: the event's own penalty
        b.balls += 1;
        b.runs += offBat;
        if (offBat === 4) b.fours += 1;
        if (offBat === 6) b.sixes += 1;
      }
      if (bowlId) {
        const w = ensure(bowlId, bowlSide, bowlName);
        if (legal) w.bowl_balls += 1;
        if (!bye) w.bowl_runs += runs; // wides/no-balls ARE charged to the bowler; byes/leg-byes are not
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
          b.dismissal = wt === 'retirednotout' ? 'retired_not_out' : 'retired_hurt'; // BUILD 3.4
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
        if (wt !== 'runout' && wt !== 'retired' && wt !== 'retiredhurt' && wt !== 'retiredout' && wt !== 'retirednotout') w.bowl_wickets += 1;
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
export interface PointPlayerLine { side: 'A' | 'B'; name?: string; points: number; assists: number; /** BUILD 3.35: only once they've fouled. */ fouls?: number }
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
    } else if (e.event_type === 'foul') {
      // BUILD 3.35: a player's fouls, on the scorecard (and the career stat already counts them).
      const line = (players[id] ??= { side: sideOfPayload(p), points: 0, assists: 0 });
      if (!line.name) { const nm = nameFromPayload(p); if (nm) line.name = nm; }
      line.fouls = (line.fouls ?? 0) + 1;
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
  // Cricket gap 9: a super over's balls don't count in anyone's figures.
  if (slug === 'cricket') return aggregateCricketPlayers(mainEvents(events));
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
export async function recomputeSummary(
  matchId: string,
  opts: { persist?: boolean; emptyMeansZero?: boolean } = {},
): Promise<Record<string, any> | null> {
  // The match and its events are independent reads — fetched together, and the
  // sport comes from the process cache: this runs on EVERY scoring event and at
  // completion, and each sequential round-trip costs ~300 ms from Render.
  const [{ data: match }, { data: eventRows }] = await Promise.all([
    supabase.from('matches').select('sport_id, score_summary, format, overs, rules').eq('id', matchId).maybeSingle(),
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
  // no scoring events to recompute from — except after an undo or delete took
  // the last one away (B06-F2): then the empty log IS the score, and keeping the
  // old summary left Home's live card on "Game 1 1-0" with nothing scored.
  const events = eventRows ?? [];
  if (events.length === 0 && !opts.emptyMeansZero) return existing;

  const A: Record<string, any> = { score: 0 };
  const B: Record<string, any> = { score: 0 };
  let tennisState: TennisScore | null = null;
  let carromBoardsPlayed: number | null = null; // A5: boards played in the carrom game in play
  let tieRubbers: { rubber: number; results: Array<{ A: number; B: number; winner: 'A' | 'B' | 'draw' }> } | null = null; // BUILD 3.49 · Stage 11 · PB9: a level timed match
  let tieSummary: ReturnType<typeof rollupTieSpec>['tie'] | null = null; // Stage 9 · T3
  let sideOutServe: { side: 'A' | 'B'; number: 1 | 2 } | null = null; // BUILD 3.58
  let tennisBuzzer = false; // BUILD 3.66
  let rallyBuzzer = false; let rallyLevel = false; let rallyTimedWinner: 'A' | 'B' | null = null; // Stage 11 · PB9
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
    const allOut = allOutBySide(lineup ?? [], rulesOf('cricket', match).players, rulesOf('cricket', match).lastManStands); // BUILD 3.2
    // Cricket gap 9: the match's innings are its own events; super overs are kept apart.
    for (const e of mainEvents(events)) {
      const p: any = e.payload || {};
      const inn = sides[sideOf(p)];
      // F-15: who batted first, from play — the side on the first delivery. The
      // result reads it when no toss was recorded, to tell a chase from a defence.
      if (cricketFirstBat === null && (e.event_type === 'ball' || e.event_type === 'extra' || e.event_type === 'wicket')) {
        cricketFirstBat = sideOf(p);
      }
      if (e.event_type === 'ball') { inn.runs += Number(p.runs ?? 0) + penaltyRunsOf(p); if (!p.is_extra) inn.balls += 1; } // BUILD 3.14: a roof penalty
      else if (e.event_type === 'extra') {
        inn.runs += Number(p.runs ?? 0);
        // Byes / leg-byes ARE legal deliveries (the over progresses); wides /
        // no-balls are not. Count the ball accordingly (A5-010/A5-012).
        if (isBallOfOver('extra', p)) inn.balls += 1;
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
    // BUILD 1.3: record a side bowled out at ITS all-out count (line-up − 1,
    // capped at 10), so NRR can charge it the full quota. Standings read this
    // instead of assuming 10 wickets — a 6-a-side side is all out at 5.
    for (const s of ['A', 'B'] as const) {
      if ((sides[s] as { wickets?: number }).wickets! >= allOut[s]) Object.assign(sides[s], { all_out: true });
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
  } else if ((slug === 'tennis' || SET_CONFIG[slug] || slug === 'chess' || slug === 'carrom') && tieSpecOf(slug, rulesOf(slug, match))) { // Stage 12 · CH5: team chess and carrom ties too
    // Stage 9 · T3: a team tie (any tie sport; badminton / table tennis's standard orders too).
    const rules = rulesOf(slug, match);
    // Stage 11 follow-up: the teams' trump picks count a match double for the side that picked it.
    const tSpec = tieSpecOf(slug, rules)!;
    const t = rollupTieSpec(slug, rules, { ...tSpec, trumps: tSpec.trump ? await trumpsFor(matchId) : null }, events, sideOf);
    A.score = t.scoreA; B.score = t.scoreB;
    A.sets = t.setsA; B.sets = t.setsB;
    A.games = t.gamesA; B.games = t.gamesB; // in the rubber in play
    A.points = t.curA; B.points = t.curB;
    tieRubbers = { rubber: t.rubber, results: t.results };
    tieSummary = t.tie;
  } else if (slug === 'tennis') {
    // T-1/T-2 · per-POINT events through the shared rule (utils/tennisCore, the
    // same file the app scores with): points → games → sets, with a real 6-6
    // tiebreak. The server used to count every point as a GAME.
    // Decision B: "1 set" or "best of 3" — the match's preset.
    // BUILD 3.66: a timed match's 'buzzer' note ends it on the leader (tennisReplayEvents).
    const tr = tennisReplayEvents(
      events.map((e) => ({ event_type: e.event_type, payload: { ...(e.payload || {}), team_side: sideOf(e.payload || {}) } })),
      tennisOptsOf(rulesOf('tennis', match)), // BUILD 2.3 / 3.59+: the match's rules
    );
    tennisState = tr.score;
    if (tr.buzzer) tennisBuzzer = true;
    A.score = tennisState.setsWon.A; B.score = tennisState.setsWon.B;       // sets won
    A.sets = tennisState.sets.map((x) => x.A); B.sets = tennisState.sets.map((x) => x.B); // games per set
    A.games = tennisState.games.A; B.games = tennisState.games.B;           // current set
    A.points = tennisState.points.A; B.points = tennisState.points.B;       // current game / tiebreak
  } else if (slug === 'carrom' && rulesOf('carrom', match).carromMode === 'points') {
    // BUILD 3.77: point carrom — every piece scores for whoever pocketed it.
    const r = rulesOf('carrom', match);
    const pc = pointCarromReplay(
      events
        .filter((e) => e.event_type === 'score' && (e.payload as any)?.kind === 'coin')
        .map((e) => ({ side: sideOf(e.payload || {}), coin: (e.payload as any).coin }))
        .filter((x) => x.coin === 'white' || x.coin === 'black' || x.coin === 'queen'),
      { gamesToWin: winsToWin(r), queenValue: r.queenValue ?? 50 },
    );
    A.score = pc.gamesWon.A; B.score = pc.gamesWon.B;
    A.sets = pc.games.map((g) => g.A); B.sets = pc.games.map((g) => g.B);
    A.points = pc.points.A; B.points = pc.points.B;
  } else if (slug === 'carrom' && events.some((e) => e.event_type === 'score' && (e.payload as any)?.kind === 'board')) {
    // A5 · real carrom rules through the shared carromCore (the file the app
    // scores with): boards → games to 25 → best of 1 or 3 games. A carrom match
    // scored before this (+1 piece events, no board events) keeps the old rollup
    // below, so its record reads as it always did.
    const timed = !!rulesOf('carrom', match).gameMinutes; // BUILD 3.76: time called ends a timed game
    const c = carromReplay(
      events
        .filter((e) => (e.event_type === 'score' && (e.payload as any)?.kind === 'board') || (timed && e.event_type === 'note' && (e.payload as any)?.kind === 'buzzer'))
        .map((e) => {
          const p: any = e.payload || {};
          if (e.event_type === 'note') return { buzzer: true as const };
          return { winner: sideOf(p), piecesLeft: carromPieces(p.pieces_left), queen: p.queen === true };
        }),
      carromOptsOf(rulesOf('carrom', match)), // BUILD 2.3 / 3.72+: target, queen, …
    );
    A.score = c.gamesWon.A; B.score = c.gamesWon.B;                        // games won
    A.sets = c.games.map((g) => g.A); B.sets = c.games.map((g) => g.B);    // each game's final score
    A.points = c.points.A; B.points = c.points.B;                          // the game in play
    carromBoardsPlayed = c.boards;
  } else if (SET_CONFIG[slug]) {
    // Decision B: best-of from the match's preset (the deciding set is still the
    // last possible one, so a best-of-3 volleyball match plays its 3rd to 15).
    // BUILD 2.3: every number from the match's rules (the standards for a match
    // stored before rules were data).
    const rules = rulesOf(slug, match);
    const cfg = setConfigOf(rules);
    if (slug === 'pickleball' && rules.scoring === 'sideout') {
      // BUILD 3.58: side-out scoring — only the server scores, so the serve is
      // replayed (the shared pickleballCore, as the app scores it).
      const s = sideOutReplay(events.filter((e) => rules.timeLimitMinutes || !(e.event_type === 'note' && (e.payload as any)?.kind === 'buzzer')), { target: cfg.target, winBy2: cfg.winBy2, maxGames: cfg.maxSets, doubles: rules.players === DOUBLES_PLAYERS, ...(cfg.allGames ? { allGames: true } : {}), ...(rules.timeLimitMinutes ? { timedLevel: rules.timedLevel ?? 'next_point' } : {}) });
      A.score = s.won.A; B.score = s.won.B;
      A.sets = s.games.map((g) => g.A); B.sets = s.games.map((g) => g.B);
      A.points = s.cur.A; B.points = s.cur.B;
      sideOutServe = { side: s.server, number: s.serverNum };
      if (s.buzzer) rallyBuzzer = true; // Stage 11 · PB9
      if (s.level) rallyLevel = true;
      if (s.winner && s.buzzer) rallyTimedWinner = s.winner;
    } else if (rules.rubbers) { // BUILD 3.54: table tennis ties too
      // BUILD 3.49: a team tie — the score is rubbers won; sets are every game.
      const t = rollupTie(cfg, rules.rubbers, events, sideOf);
      A.score = t.rubbersA; B.score = t.rubbersB;
      A.sets = t.setScoresA; B.sets = t.setScoresB;
      A.games = t.gamesA; B.games = t.gamesB; // games in the rubber in play
      A.points = t.curA; B.points = t.curB;
      tieRubbers = { rubber: t.rubber, results: t.results };
    } else {
      const r = rollupSets(cfg, events, sideOf, rules.timeLimitMinutes ? { level: rules.timedLevel === 'draw' ? 'draw' : 'next_point' } : null); // Stage 11 · PB9
      A.score = r.setsA; B.score = r.setsB;
      A.sets = r.setScoresA; B.sets = r.setScoresB;
      A.points = r.curA; B.points = r.curB; // current in-progress set/board
      if (r.buzzer) rallyBuzzer = true; // Stage 11 · PB9
      if (r.level) rallyLevel = true;
      if (r.decided && r.buzzer) rallyTimedWinner = r.decided;
    }
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
  // Cricket gap 9: the super overs played ball by ball, each side's runs / balls / wickets.
  if (slug === 'cricket') {
    const sos = superOversOf(events, cricketFirstBat ?? 'A');
    if (sos.length) summary.super_overs = sos;
    else delete summary.super_overs;
  }
  if (slug === 'chess' && !tieSummary) { // Stage 12 · CH5: a team match's summary is its tie's
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
  if (tieRubbers) { summary.rubber = tieRubbers.rubber; summary.rubbers = tieRubbers.results; } // BUILD 3.49
  if (tieSummary) summary.tie = tieSummary; // Stage 9 · T3: the win rule, rubbers and games each side
  if (sideOutServe) summary.serve = sideOutServe; // BUILD 3.58: who serves, and (doubles) server 1 or 2
  // BUILD 3.66 / Stage 11 · PB9: time was called (tennis, a timed rally match);
  // a rally match that ended level at the buzzer says so. Recomputed each time
  // (an undone buzzer takes them away).
  delete summary.buzzer; delete summary.timed_level;
  if (tennisBuzzer || rallyBuzzer) summary.buzzer = true;
  if (rallyLevel) summary.timed_level = true;
  void rallyTimedWinner;
  if (tennisState) {
    // The tiebreak in play, and each completed set's tiebreak points (or null),
    // so a hub card or result can say "7–6 (7–5)".
    summary.tiebreak = tennisState.tiebreak;
    summary.set_tiebreaks = tennisState.sets.map((x) => x.tiebreak ?? null);
    if (tennisState.matchTiebreak) summary.match_tiebreak = true; // BUILD 3.62: the final set's match tiebreak is in play
  }
  // Chess has no scoring events, so aggregatePlayers yields an empty map. Instead
  // represent the credited WINNER as a 1-entry rollup keyed by their player_id
  // (guest-safe) with { name, side: winner_side }, so the scorecard/MVP can
  // attribute the result for casual/guest chess (registered chess already had a
  // participant fallback). A draw → empty map → no MVP.
  if (slug === 'chess' && !tieSummary) {
    summary.players = chessWinnerId
      ? { [chessWinnerId]: { side: chessWinner, name: chessWinnerName ?? undefined, points: 1 } }
      : {};
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
  // B06: carried over BEFORE the write, not after it — written after, the
  // returned summary kept these keys but the stored one lost them on every
  // scoring event, so the next recompute had nothing to carry.
  if (opts.persist !== false) {
    await supabase
      .from('matches')
      .update({ score_summary: summary, updated_at: new Date().toISOString() })
      .eq('id', matchId);
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

  const players = aggregateCricketPlayers(mainEvents(events as any[])); // gap 9: not the super overs
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
      return res.status(409).json({ error: 'This match is finished and can no longer be edited', code: 'MATCH_FINISHED' });
    }

    const { data: latest } = await supabase
      .from('match_events')
      .select('*')
      .eq('match_id', matchId)
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) return res.status(404).json({ error: 'No event to undo' });
    // Hard-delete list #7: the undo stays a real delete, but it is logged first
    // — who, when, and the whole event as it was. No log row, no delete.
    const removed = await logThenDeleteEvent(latest as { id: string; match_id: string }, userId, 'undo');
    if (removed.error) return res.status(500).json({ error: removed.error });
    // Recompute the summary from the remaining events so it can't drift out of
    // sync with the event log (the old code left score_summary stale on undo).
    try {
      await recordScoreAfter(removed.auditId, await recomputeSummary(matchId, { emptyMeansZero: true }));
    } catch {
      // best-effort — the event delete already succeeded
    }
    return res.json({ deleted: true });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}


/**
 * Stage 10 · TT3 · POST /matches/:id/typed-score { sets } or { rubbers } — a
 * match scored on paper, typed in by the organiser, umpire, creator or scorer.
 * The games / sets become the points the pad would have sent (marked typed;
 * utils/typedScore checks them by the match's own rules), after one note for
 * the timeline; the summary is worked out as for a live match. The app then
 * completes the match as usual. Only for a match with no points on the pad.
 */
export async function typedScore(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    const { data: m } = await supabase.from('matches')
      .select('id, sport_id, status, voided_at, rules, format, overs, created_by, umpire_id, scorer_id, tournament_id, team_a_id, team_b_id')
      .eq('id', id).maybeSingle();
    if (!m) return res.status(404).json({ error: 'Match not found' });
    if (!(await canOfficiateMatch(m as never, userId))) return res.status(403).json({ error: 'Only the organiser, the umpire or a scorer can enter the result.' });
    if ((m as { voided_at?: string | null }).voided_at || m.status === 'completed' || m.status === 'abandoned' || m.status === 'cancelled') {
      return res.status(409).json({ error: 'This match is already finished.', code: 'MATCH_FINISHED' });
    }
    const slug = normSportSlug((await getSport(m.sport_id as string))?.slug);
    // Stage 12 · CH5: a team chess match typed from its match sheet — each board's result.
    const chessSpec = slug === 'chess' ? tieSpecOf(slug, rulesOf(slug, m as never) as MatchRules) : null;
    if (chessSpec) {
      const { count: done } = await supabase.from('match_events').select('id', { count: 'exact', head: true }).eq('match_id', id).eq('event_type', 'result');
      if (done) return res.status(409).json({ error: 'This match has board results on the pad — finish it there, or undo them first.', code: 'SCORED_ON_PAD' });
      const got = typedChessBoards(chessSpec, (req.body ?? {}).boards);
      if (got.problem) return res.status(400).json({ error: got.problem, code: 'BAD_TYPED_SCORE' });
      const words = got.results.map((w, i) => `${chessSpec.rubbers[i]?.label ?? `Board ${i + 1}`} ${w === 'white' ? '1-0' : w === 'black' ? '0-1' : '½-½'}`).join(' · ');
      const base = Date.now();
      const rows = [
        { match_id: id, event_type: 'note', payload: { kind: 'typed_score', text: words }, created_by: userId, created_at: new Date(base).toISOString() },
        ...got.results.map((w, i) => ({ match_id: id, event_type: 'result', payload: { winner: w, typed: true }, created_by: userId, created_at: new Date(base + 1 + i).toISOString() })),
      ];
      const { error } = await supabase.from('match_events').insert(rows);
      if (error) return res.status(500).json({ error: 'The result wasn’t saved. Try again.' });
      await promoteToLive(id, m);
      const summary = await recomputeSummary(id, { persist: true });
      const winner = got.winner === 'A' || got.winner === 'B' ? got.winner : null;
      return res.json({ ok: true, winner_side: winner, winner_team_id: winner ? (winner === 'A' ? m.team_a_id : m.team_b_id) : null, draw: got.winner === 'draw', text: words, summary });
    }
    if (!typedScoreSport(slug)) return res.status(400).json({ error: 'Typed scores are for the sports scored in games or sets.', code: 'NOT_TYPED_SPORT' });
    const { count } = await supabase.from('match_events').select('id', { count: 'exact', head: true }).eq('match_id', id).eq('event_type', 'score');
    if (count) return res.status(409).json({ error: 'This match has points on the pad — finish it there, or undo them first.', code: 'SCORED_ON_PAD' });
    const rules = rulesOf(slug, m as never) as MatchRules;
    const spec0 = tieSpecOf(slug, rules);
    const spec = spec0 ? { ...spec0, trumps: spec0.trump ? await trumpsFor(id) : null } : null; // Stage 11 follow-up: the teams' trump picks
    const body = (req.body ?? {}) as { sets?: unknown; rubbers?: unknown };
    const got = spec ? typedTiePoints(slug, rules, spec, body.rubbers) : typedMatchPoints(slug, rules, body.sets);
    if (got.problem) return res.status(400).json({ error: got.problem, code: 'BAD_TYPED_SCORE' });
    const text = spec
      ? (body.rubbers as TypedSet[][]).map((sets, i) => `${spec.rubbers[i]?.label ?? `Match ${i + 1}`} ${typedScoreText(sets)}`).join(' · ')
      : typedScoreText(body.sets as TypedSet[]);
    // In order: the note, then each point a millisecond apart (the log reads by time).
    const base = Date.now();
    const rows = [
      { match_id: id, event_type: 'note', payload: { kind: 'typed_score', text }, created_by: userId, created_at: new Date(base).toISOString() },
      ...got.points.map((p, i) => ({ match_id: id, event_type: 'score', payload: { team_side: p.side, typed: true, ...(p.kind ? { kind: p.kind } : {}) }, created_by: userId, created_at: new Date(base + 1 + i).toISOString() })),
    ];
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('match_events').insert(rows.slice(i, i + 500));
      if (error) return res.status(500).json({ error: 'The result wasn’t saved. Try again.' });
    }
    await promoteToLive(id, m);
    const summary = await recomputeSummary(id, { persist: true });
    const winner = got.winner === 'A' || got.winner === 'B' ? got.winner : null;
    return res.json({ ok: true, winner_side: winner, winner_team_id: winner ? (winner === 'A' ? m.team_a_id : m.team_b_id) : null, draw: got.winner === 'draw', text, summary });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
