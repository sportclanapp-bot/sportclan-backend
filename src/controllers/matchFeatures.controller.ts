import { isAdminUser } from '../middleware/admin.middleware';
import { getSport, normSportSlug } from '../utils/sportCache';
import { AuditRow, LogContext, cricketBallLabels, editLine } from '../utils/editLog';
import { logEventEdit, logThenDeleteEvent, recordScoreAfter } from '../utils/scoringAudit';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { calculateDLSTarget, dlsInputProblem } from '../utils/dls';
import { aggregatePlayers, isGuestId, recomputeSummary, type CricketPlayerLine } from './scoring.controller';
import { isTerminalMatchStatus } from '../utils/validation';
import { canOfficiateMatch } from '../utils/tournamentAuth';
import { checkLease } from '../utils/scoringLease';
import { deviceIdOf } from '../utils/deviceHeader';
import { isSinglesShape } from '../utils/singles';
import { viewerCanPlay } from '../utils/viewerCanPlay';
import { notifyUser } from '../utils/notify';
import { leaseRefusal } from '../utils/leaseCore';
import { isUuid } from '../utils/uuid';
import { rulesOf, legacyFromRules } from '../utils/matchRules';
import { allOutBySide, inningsFinished, reduceOversRefusal } from '../utils/cricketRules';
import { chasingSide } from '../utils/matchResult';

/**
 * Shared gate for match-mutating feature endpoints (DLS, event edit/delete,
 * innings stats): the caller must be the creator/umpire (SC-42 also adds the
 * missing auth check to DLS/innings which previously had none), and a finished
 * match is immutable (409). Returns { error } to short-circuit, or {} to pass.
 */
async function loadScorableMatch(
  id: string,
  userId: string,
  deviceId?: string | null,
): Promise<{ error?: { status: number; msg: string; code?: string } }> {
  const { data: match } = await supabase
    .from('matches')
    .select('created_by, umpire_id, tournament_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!match) return { error: { status: 404, msg: 'Match not found' } };
  // SC-319: align to canOfficiateMatch (SC-287's single authority) so a tournament
  // co-organiser acting as scorer isn't blocked — the old created_by||umpire_id
  // check was narrower than the scoring API's own gate.
  if (!(await canOfficiateMatch(match, userId))) {
    return { error: { status: 403, msg: 'Only the scorer, umpire, or tournament organiser can modify this match' } };
  }
  // Terminal-status matches stay FROZEN (SC-42/85) — an edit can never change a
  // winner post-completion → no ELO double-apply. Keep exactly as-is.
  if (isTerminalMatchStatus(match.status)) {
    return { error: { status: 409, msg: 'This match is finished and can no longer be modified', code: 'MATCH_FINISHED' } };
  }
  // SC-430: one scorer per match. Being ALLOWED to score is not the same as being
  // the one currently scoring — a second phone editing or deleting an event while
  // somebody else holds the pad is exactly the conflicting write the lease exists
  // to stop. Displacing them is possible, but it goes through takeover, which
  // records who and why.
  if (deviceId !== undefined) {
    const verdict = await checkLease(id, userId, deviceId);
    if (!verdict.ok) {
      const r = leaseRefusal(verdict, userId);
      return { error: { status: 409, msg: r.error, code: r.code } };
    }
  }
  return {};
}

/**
 * Phase 3 · the challenger hears the answer. Only when the one answering is the
 * singles opponent (side B of a no-team, one-a-side match) — a team member's
 * RSVP to a team match stays the quiet thing it always was. Best-effort.
 */
async function notifyChallengerOfAnswer(matchId: string, userId: string, accepted: boolean): Promise<void> {
  try {
    const [{ data: match }, { data: parts }] = await Promise.all([
      supabase.from('matches').select('id, created_by, team_a_id, team_b_id, team_b_name, is_ranked, status, is_open').eq('id', matchId).maybeSingle(),
      supabase.from('match_participants').select('user_id, team_side').eq('match_id', matchId),
    ]);
    if (!match || isTerminalMatchStatus(match.status)) return;
    if (!isSinglesShape(match, parts ?? [])) return;
    const opponent = (parts ?? []).find((p) => p.team_side === 'B')?.user_id;
    if (opponent !== userId || !match.created_by || match.created_by === userId) return;
    const who = match.team_b_name ?? 'Your opponent';
    await notifyUser({
      userId: match.created_by,
      type: accepted ? 'match_challenge_accepted' : 'match_challenge_declined',
      title: accepted ? `${who} accepted` : `${who} declined`,
      body: accepted
        ? `Your ${match.is_ranked ? 'ranked ' : ''}singles match is on.`
        : 'They can’t make this match. You can cancel it or pick another time.',
      data: { matchId, screen: 'MatchDetail' },
    });
  } catch { /* best-effort */ }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 1 — MVP / Player of the Match
// ────────────────────────────────────────────────────────────────────────────

/** F-36 · sports whose Player of the Match must be on the winning side. */
export const MVP_FROM_WINNING_SIDE: ReadonlySet<string> = new Set(['badminton', 'tabletennis', 'pickleball', 'volleyball', 'tennis', 'carrom']);

export async function calculateAndSetMVP(matchId: string): Promise<string | null> {
  // Get match + sport + events + participants
  const { data: match } = await supabase
    .from('matches')
    .select('sport_id, winner_team_id, score_summary')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return null;

  const { data: sportRow } = await supabase.from('sports').select('slug').eq('id', match.sport_id).maybeSingle();
  // Normalise so 'table-tennis' matches the single-token family checks below.
  const slug = (sportRow?.slug ?? '').toLowerCase().replace(/[-_\s]/g, '');

  const { data: events } = await supabase
    .from('match_events')
    .select('event_type, payload, created_by')
    .eq('match_id', matchId);
  const { data: participants } = await supabase
    .from('match_participants')
    .select('user_id, team_side')
    .eq('match_id', matchId);

  // Attribution rollup — the authoritative per-player source for every sport,
  // and the ONLY source for casual/guest matches (which have no participants).
  // It gives the candidate set, each player's side, and (for guests / SC-52
  // registered players) their display name. So MVP no longer requires
  // match_participants: unranked-registered and casual/guest matches now get a
  // real MVP too, instead of the old `if (!participants?.length) return null`.
  const roll = aggregatePlayers(slug, (events ?? []) as { event_type: string; payload: any }[]);
  const sideOf = new Map<string, 'A' | 'B'>();
  const nameOf = new Map<string, string>();
  for (const p of participants ?? []) sideOf.set(p.user_id, p.team_side as 'A' | 'B');
  for (const [uid, line] of Object.entries(roll)) {
    sideOf.set(uid, line.side);
    if (line.name) nameOf.set(uid, line.name);
  }

  // Score each candidate (every participant AND every attributed player,
  // registered or guest) with the sport-specific formula.
  const scores = new Map<string, number>();
  for (const p of participants ?? []) scores.set(p.user_id, 0);
  for (const uid of Object.keys(roll)) if (!scores.has(uid)) scores.set(uid, 0);

  // Cricket is attributed via the per-player rollup (batsman/bowler ids in the
  // event payload), NOT created_by — A5-003. Runs + wickets×25, credited to the
  // real striker/bowler (or a guest).
  if (slug === 'cricket') {
    for (const [uid, line] of Object.entries(roll)) {
      const l = line as CricketPlayerLine;
      scores.set(uid, (scores.get(uid) ?? 0) + l.runs + l.bowl_wickets * 25);
    }
  }

  // F-23: an unattributed point used to be credited to the SCORER (created_by)
  // whenever the scorer was in the line-up — so the umpire-player of a casual
  // match, or the challenger scoring a singles match, collected every point
  // with the picker skipped (and every tennis ace and double fault). A point
  // belongs to the side that won it: when that side has exactly one player
  // (singles), it is theirs; otherwise nobody can say whose it was.
  const onlyPlayerOf = new Map<string, string | null>();
  for (const p of participants ?? []) {
    const side = p.team_side as string;
    onlyPlayerOf.set(side, onlyPlayerOf.has(side) ? null : p.user_id);
  }
  for (const ev of events ?? []) {
    if (slug === 'cricket') break; // handled by the rollup above
    const p: Record<string, unknown> = (ev.payload ?? {}) as Record<string, unknown>;
    const uid = (p.player_id as string) || onlyPlayerOf.get(String(p.team_side ?? '')) || null;
    if (!uid || !scores.has(uid)) continue;
    const cur = scores.get(uid) ?? 0;

    if (slug === 'football' || slug === 'hockey') {
      // Goals×30 + assists×15. Rulesets emit event_type:'score' with
      // payload.kind:'goal' (not event_type:'goal') — A5-005.
      if (ev.event_type === 'score' && p.kind === 'goal') scores.set(uid, cur + 30);
      else if (ev.event_type === 'assist') scores.set(uid, cur + 15);
    } else if (slug === 'basketball') {
      // Points (the basketball ruleset sends the value under payload.value,
      // not payload.points — A5-006) + assists×3.
      if (ev.event_type === 'basket' || ev.event_type === 'score') scores.set(uid, cur + Number(p.value ?? 0));
      else if (ev.event_type === 'assist') scores.set(uid, cur + 3);
    } else if (['badminton', 'tennis', 'tabletennis', 'pickleball', 'volleyball'].includes(slug)) {
      // Points won
      if (ev.event_type === 'score' || ev.event_type === 'point') scores.set(uid, cur + 1);
    } else if (slug === 'carrom') {
      // Points pocketed — carrom sends the value under payload.value (A5-009).
      scores.set(uid, cur + Number(p.value ?? 1));
    } else if (slug === 'chess') {
      // Winner gets MVP — handled below
    } else {
      // Generic: any scoring event
      scores.set(uid, cur + Number(p.runs ?? p.points ?? 1));
    }
  }

  // Chess special: winner auto-MVP. Pick the participant on the winning SIDE.
  // (The old code compared match.winner_team_id to itself — always true — so it
  // always returned the first team-A participant regardless of who won, A5-008.)
  const winnerSide = (match.score_summary as { winner_side?: 'A' | 'B' })?.winner_side ?? null;
  if (slug === 'chess' && winnerSide) {
    // Winner auto-MVP. Chess has no scoring events, so recomputeSummary stamps
    // the credited winner into score_summary.players (keyed by player_id, with
    // side = winner_side) — that's the primary, guest-capable source and makes
    // casual/guest chess get a real MVP. Fall back to a registered participant
    // on the winning side when the scorer skipped attribution.
    const players = (match.score_summary as {
      players?: Record<string, { side?: string; name?: string }>;
    })?.players ?? {};
    const creditedId = Object.keys(players).find((id) => players[id]?.side === winnerSide);
    if (creditedId) {
      const nm = players[creditedId]?.name;
      if (nm && !nameOf.has(creditedId)) nameOf.set(creditedId, nm);
      sideOf.set(creditedId, winnerSide);
      scores.set(creditedId, 9999);
    } else {
      const winner = (participants ?? []).find((p2) => p2.team_side === winnerSide);
      if (winner) scores.set(winner.user_id, 9999);
    }
  }

  // Find top scorer. Tie-breaker (SC-14): higher score → player on the winning
  // side → lowest id (stable/deterministic). `sideOf` was built above from
  // participants ∪ rollup, so it covers guests too.
  let mvpId: string | null = null;
  let best: { score: number; onWinning: boolean; uid: string } | null = null;
  // F-36 (decision 2026-09-25): in the game-and-set sports the Player of the
  // Match comes from the winning side. "Most points" alone made the loser of a
  // 2-1 singles match its Player of the Match (28 points to 27) under a result
  // screen naming the other player the winner.
  const winnersOnly = winnerSide != null && MVP_FROM_WINNING_SIDE.has(slug);
  for (const [uid, score] of scores) {
    if (score <= 0) continue; // no contribution → never MVP
    if (winnersOnly && sideOf.get(uid) !== winnerSide) continue;
    const onWinning = winnerSide != null && sideOf.get(uid) === winnerSide;
    const better =
      best === null ||
      score > best.score ||
      (score === best.score && onWinning && !best.onWinning) ||
      (score === best.score && onWinning === best.onWinning && uid < best.uid);
    if (better) best = { score, onWinning, uid };
  }
  mvpId = best?.uid ?? null;

  // Persist. Real users → mvp_user_id (FK; feeds profile MVP tallies). Guests →
  // name-only in score_summary.mvp for DISPLAY; mvp_user_id stays null so a
  // guest never touches any real user's stats/leaderboard/ELO.
  const guest = mvpId ? isGuestId(mvpId) : false;
  const summary =
    match.score_summary && typeof match.score_summary === 'object'
      ? (match.score_summary as Record<string, unknown>)
      : {};
  await supabase
    .from('matches')
    .update({
      mvp_user_id: mvpId && !guest ? mvpId : null,
      score_summary: {
        ...summary,
        mvp: mvpId ? { id: mvpId, name: nameOf.get(mvpId) ?? null, guest } : null,
      },
    })
    .eq('id', matchId);
  return mvpId;
}

const mvpTried = new Set<string>();

export async function getMatchMVP(req: Request, res: Response) {
  try {
    const { id } = req.params;
    let { data: match } = await supabase
      .from('matches')
      .select('mvp_user_id, score_summary, status')
      .eq('id', id)
      .maybeSingle();

    // Completion computes the MVP AFTER responding (it held the scorer ~1.3 s),
    // so a result screen that asks first computes it here. Idempotent — the
    // background pass reaches the same answer.
    const ss0 = (match?.score_summary ?? null) as { mvp?: unknown } | null;
    if (match && match.status === 'completed' && !match.mvp_user_id && !ss0?.mvp && !mvpTried.has(id)) {
      mvpTried.add(id); // a match that has no MVP (name-only casual) is tried once, not on every view
      await calculateAndSetMVP(id).catch(() => null);
      ({ data: match } = await supabase
        .from('matches')
        .select('mvp_user_id, score_summary, status')
        .eq('id', id)
        .maybeSingle());
    }

    // Real-user MVP — resolve the full user (feeds the profile MVP tally).
    if (match?.mvp_user_id) {
      const { data: user } = await supabase
        .from('users')
        .select('id, name, username, profile_picture_url')
        .eq('id', match.mvp_user_id)
        .maybeSingle();
      if (user) return res.json({ mvp: { ...user, guest: false } });
    }

    // Guest / name-only MVP (casual matches) — display-only, no users row.
    const gm = (match?.score_summary as { mvp?: { id?: string; name?: string; guest?: boolean } } | null)?.mvp;
    if (gm?.guest && gm.name) {
      return res.json({
        mvp: { id: gm.id, name: gm.name, username: null, profile_picture_url: null, guest: true },
      });
    }
    return res.json({ mvp: null });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 3 — Squad Availability
// ────────────────────────────────────────────────────────────────────────────

export async function getMatchAvailability(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('match_availability')
      .select('id, user_id, team_id, status, user:users!user_id(id, name, profile_picture_url)')
      .eq('match_id', id);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ availability: data ?? [] });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function setMatchAvailability(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { status, team_id } = req.body || {};
    if (!status || !['available', 'unavailable', 'maybe'].includes(status)) {
      return res.status(400).json({ error: 'status must be available, unavailable, or maybe' });
    }

    // F-24: anyone could answer for any match — a spectator could "accept" a
    // ranked challenge meant for someone else's opponent row, and a finished
    // match still took answers. Only someone who could be in the line-up (the
    // U-13 rule: in it, or on either team's roster, never the umpire) may
    // answer, and only before the match is over.
    const { data: m } = await supabase
      .from('matches').select('id, status, team_a_id, team_b_id, umpire_id').eq('id', id).maybeSingle();
    if (!m) return res.status(404).json({ error: 'Match not found' });
    if (isTerminalMatchStatus(m.status)) {
      return res.status(409).json({ error: 'This match is over — there is nothing to answer.', code: 'MATCH_OVER' });
    }
    const { data: parts } = await supabase.from('match_participants').select('user_id').eq('match_id', id);
    if (!(await viewerCanPlay(m, userId, (parts ?? []).map((p) => p.user_id as string)))) {
      return res.status(403).json({ error: 'Only a player in this match can answer.', code: 'NOT_A_PLAYER' });
    }

    // Phase 3: for a singles match this row IS the opponent's answer to the
    // challenge. Read the previous answer so a repeat tap doesn't re-notify.
    const { data: prev } = await supabase
      .from('match_availability')
      .select('status')
      .eq('match_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    const { data, error } = await supabase
      .from('match_availability')
      .upsert(
        { match_id: id, user_id: userId, team_id: team_id ?? null, status, updated_at: new Date().toISOString() },
        { onConflict: 'match_id,user_id' },
      )
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    if ((prev as { status?: string } | null)?.status !== status && status !== 'maybe') {
      void notifyChallengerOfAnswer(id, userId, status === 'available');
    }
    return res.json({ availability: data });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 5 — DLS Method
// ────────────────────────────────────────────────────────────────────────────

export async function applyDLS(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { team1_score, total_overs, team2_overs_remaining, team2_wickets } = req.body || {};

    if (team1_score == null || total_overs == null || team2_overs_remaining == null || team2_wickets == null) {
      return res.status(400).json({ error: 'team1_score, total_overs, team2_overs_remaining, team2_wickets required' });
    }
    const gate = await loadScorableMatch(id, userId, deviceIdOf(req));
    if (gate.error) return res.status(gate.error.status).json({ error: gate.error.msg, ...(gate.error.code ? { code: gate.error.code } : {}) });

    // F-44: before the gate this endpoint answered anything it was asked,
    // including a match of zero overs, and stored the answer on the match.
    const problem = dlsInputProblem({
      team1Score: Number(team1_score),
      totalOvers: Number(total_overs),
      team2OversLeft: Number(team2_overs_remaining),
      team2Wickets: Number(team2_wickets),
    });
    if (problem) return res.status(400).json({ error: problem, code: 'DLS_IMPOSSIBLE' });

    const result = calculateDLSTarget(
      Number(team1_score),
      Number(total_overs),
      Number(team2_overs_remaining),
      Number(team2_wickets),
    );

    // Store in match score_summary
    const { data: match } = await supabase
      .from('matches')
      .select('score_summary')
      .eq('id', id)
      .maybeSingle();
    const ss = (match?.score_summary ?? {}) as Record<string, unknown>;
    ss.dls_target = result.revisedTarget;
    ss.dls_applied = true;
    ss.dls_resources = { team1: result.resourcesTeam1, team2: result.resourcesTeam2 };

    await supabase.from('matches').update({ score_summary: ss }).eq('id', id);

    return res.json(result);
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// BUILD 3.12 · POST /matches/:id/reduce-overs { overs } — rain or light cuts a
// match short: both sides get the same, fewer overs (an equal cut, as local
// cricket does; a chase-only cut is DLS). The match's own overs change, so the
// pad, Match Detail, the end-of-match rule and the NRR quota all follow; the
// original is kept as score_summary.overs_reduced { from, to }.
export async function reduceOvers(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const gate = await loadScorableMatch(id, userId, deviceIdOf(req));
    if (gate.error) return res.status(gate.error.status).json({ error: gate.error.msg, ...(gate.error.code ? { code: gate.error.code } : {}) });
    const { data: match } = await supabase
      .from('matches')
      .select('id, sport_id, format, overs, rules, score_summary, toss_choice')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const slug = normSportSlug((await getSport(match.sport_id as string))?.slug);
    if (slug !== 'cricket') return res.status(400).json({ error: 'Only a cricket match has overs to reduce.', code: 'NOT_CRICKET' });
    const rules = rulesOf('cricket', match);
    const from = rules.overs ?? 20;
    const cs = (match.score_summary ?? {}) as Record<string, any>;
    const facts = (x: any) => ({ runs: Number(x?.runs ?? 0), wickets: Number(x?.wickets ?? 0), balls: Number(x?.balls ?? 0), declared: x?.declared === true });
    const chaser = chasingSide(cs.toss_winner_side ?? null, match.toss_choice ?? null, cs.first_batting_side ?? null);
    const firstSide: 'A' | 'B' = chaser === 'A' ? 'B' : 'A';
    const first = facts(cs[firstSide]);
    const chase = facts(cs[firstSide === 'A' ? 'B' : 'A']);
    const { data: parts } = await supabase.from('match_participants').select('team_side').eq('match_id', id);
    const allOut = allOutBySide(parts ?? [], rules.players, rules.lastManStands);
    const to = Number.isFinite(Number(req.body?.overs)) ? Number(req.body.overs) : req.body?.overs;
    const refusal = reduceOversRefusal({
      from, to, firstBalls: first.balls, chaseBalls: chase.balls,
      firstDone: chase.balls > 0 || inningsFinished(first, from, allOut[firstSide]),
    });
    if (refusal) return res.status(400).json({ error: refusal, code: 'BAD_REDUCE_OVERS' });
    // A max-overs-per-bowler above the new overs comes down with them.
    const next = { ...rules, overs: to as number, bowlerOvers: rules.bowlerOvers != null ? Math.min(rules.bowlerOvers, to as number) : null };
    const legacy = legacyFromRules('cricket', next);
    const summary = { ...cs, overs_reduced: { from: cs.overs_reduced?.from ?? from, to } };
    const { error } = await supabase.from('matches')
      .update({ rules: next, overs: legacy.overs, format: legacy.format, score_summary: summary, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ overs: to, from: summary.overs_reduced.from, format: legacy.format, rules: next });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 6 — Live Match Edit
// ────────────────────────────────────────────────────────────────────────────

export async function editMatchEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { event_id, changes } = req.body || {};
    if (!event_id || !changes) return res.status(400).json({ error: 'event_id and changes required' });

    // Verify scorer/umpire/creator + reject finished matches (SC-42)
    const gate = await loadScorableMatch(id, userId, deviceIdOf(req));
    if (gate.error) return res.status(gate.error.status).json({ error: gate.error.msg, ...(gate.error.code ? { code: gate.error.code } : {}) });

    // Get current event
    const { data: event } = await supabase
      .from('match_events')
      .select('id, payload, event_type')
      .eq('id', event_id)
      .eq('match_id', id)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const oldPayload = event.payload ?? {};
    const newPayload = { ...oldPayload, ...changes };

    // Audit log — first, with the score before (scoring edit log). No log
    // row, no change: the same rule as undo and delete (#7).
    const logged = await logEventEdit({
      eventId: event_id, matchId: id, userId,
      oldPayload, newPayload, eventType: (event as { event_type?: string }).event_type ?? null,
    });
    if (logged.error) return res.status(500).json({ error: logged.error });

    // Update event
    await supabase.from('match_events').update({ payload: newPayload }).eq('id', event_id);

    // SC-319: rebuild the canonical score_summary from the full event log so the
    // scoreboard reflects the edit IMMEDIATELY (was stale until the next event).
    // recomputeSummary is stateless — the same recompute undo/completion use.
    const summary = await recomputeSummary(id);
    await recordScoreAfter(logged.auditId, summary);

    return res.json({ success: true, event: { id: event_id, payload: newPayload }, score_summary: summary });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteMatchEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id, eventId } = req.params;

    // Verify scorer/umpire/creator + reject finished matches (SC-42)
    const gate = await loadScorableMatch(id, userId, deviceIdOf(req));
    if (gate.error) return res.status(gate.error.status).json({ error: gate.error.msg, ...(gate.error.code ? { code: gate.error.code } : {}) });

    // Get event for audit
    const { data: event } = await supabase
      .from('match_events')
      .select('*')
      .eq('id', eventId)
      .eq('match_id', id)
      .maybeSingle();
    if (!event) {
      // SC-421: a queued undo is delivered AT LEAST ONCE — a timeout can hide a
      // delete that actually succeeded, and the retry then finds nothing. The
      // caller's desired end state ("this event is not on this match") already
      // holds, so answering 404 would turn a successful replay into a hard
      // rejection that halts the scorer's whole queue. Opt-in via ?idempotent=1
      // so the SC-317 editor — a human acting on an event they can see listed,
      // who genuinely wants to know it vanished — keeps its 404.
      if (String(req.query.idempotent) === '1') {
        return res.json({ success: true, already_deleted: true });
      }
      return res.status(404).json({ error: 'Event not found' });
    }

    // Hard-delete list #7: logged first — who, when, the whole event — and
    // only then deleted. (The row now outlives the event: migration 107.)
    const removed = await logThenDeleteEvent(event as { id: string; match_id: string }, userId, 'delete');
    if (removed.error) return res.status(500).json({ error: removed.error });

    // SC-319: rebuild score_summary from the remaining events (was left stale).
    // B06-F2: deleting the last one leaves a zero score, not the old one.
    const summary = await recomputeSummary(id, { emptyMeansZero: true });
    await recordScoreAfter(removed.auditId, summary);

    return res.json({ success: true, score_summary: summary });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
export const INNINGS_STATS_MAX_ROWS = 50;
/** Caps for one innings line; a count must be a whole number from 0 to its cap. */
const INNINGS_CAPS: Record<string, number> = {
  runs: 500, balls_faced: 600, fours: 150, sixes: 150,
  bowling_runs: 500, bowling_wickets: 10, bowling_maidens: 50,
  catches: 10, runouts: 10, stumpings: 10,
};
/** Phase 3 B05-F15 · one innings-stats row's shape. Exported for tests. */
export function inningsRowRefusal(rows: unknown[]): { error: string; code: string } | null {
  for (const raw of rows) {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (!isUuid(s.user_id)) return { error: 'Each row needs a player.', code: 'BAD_PLAYER' };
    if (s.innings_number != null && s.innings_number !== 1 && s.innings_number !== 2) {
      return { error: 'innings_number is 1 or 2.', code: 'BAD_INNINGS' };
    }
    for (const [k, cap] of Object.entries(INNINGS_CAPS)) {
      const v = s[k];
      if (v != null && (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > cap)) {
        return { error: `${k} must be a whole number from 0 to ${cap}.`, code: 'BAD_STAT' };
      }
    }
    const o = s.bowling_overs;
    if (o != null && (typeof o !== 'number' || !Number.isFinite(o) || o < 0 || o > 50)) {
      return { error: 'bowling_overs must be from 0 to 50.', code: 'BAD_STAT' };
    }
    if (s.dismissal_type != null && (typeof s.dismissal_type !== 'string' || s.dismissal_type.length > 30)) {
      return { error: 'dismissal_type must be short text.', code: 'BAD_STAT' };
    }
    if (s.team_id != null && !isUuid(s.team_id)) return { error: 'team_id must be an id.', code: 'BAD_STAT' };
  }
  return null;
}

// INNINGS STATS — per-innings cricket batting/bowling/fielding
// POST /matches/:id/innings-stats
// ────────────────────────────────────────────────────────────────────────────

export async function upsertInningsStats(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { stats } = req.body || {};
    if (!Array.isArray(stats) || stats.length === 0) {
      return res.status(400).json({ error: 'stats array required' });
    }
    if (stats.length > INNINGS_STATS_MAX_ROWS) {
      return res.status(400).json({ error: `Too many rows (max ${INNINGS_STATS_MAX_ROWS})` });
    }
    const gate = await loadScorableMatch(id, userId, deviceIdOf(req));
    if (gate.error) return res.status(gate.error.status).json({ error: gate.error.msg, ...(gate.error.code ? { code: gate.error.code } : {}) });
    // Phase 3 B05-F15: these rows feed career stats, so each is checked — any
    // user, any innings and junk counts ('abc' failed with a 500) were written.
    {
      const refusal = inningsRowRefusal(stats);
      if (refusal) return res.status(400).json(refusal);
      const { data: lineup } = await supabase.from('match_participants').select('user_id').eq('match_id', id);
      const inLineup = new Set(((lineup ?? []) as Array<{ user_id: string }>).map((p) => p.user_id));
      if (stats.some((s: { user_id: string }) => !inLineup.has(s.user_id))) {
        return res.status(400).json({ error: 'Every player must be in this match’s line-up.', code: 'NOT_IN_LINEUP' });
      }
    }

    const rows = stats.map((s: any) => ({
      match_id: id,
      user_id: s.user_id,
      team_id: s.team_id ?? null,
      innings_number: s.innings_number ?? 1,
      runs: s.runs ?? 0,
      balls_faced: s.balls_faced ?? 0,
      fours: s.fours ?? 0,
      sixes: s.sixes ?? 0,
      is_out: !!s.is_out,
      dismissal_type: s.dismissal_type ?? null,
      bowling_overs: s.bowling_overs ?? 0,
      bowling_runs: s.bowling_runs ?? 0,
      bowling_wickets: s.bowling_wickets ?? 0,
      bowling_maidens: s.bowling_maidens ?? 0,
      catches: s.catches ?? 0,
      runouts: s.runouts ?? 0,
      stumpings: s.stumpings ?? 0,
    }));

    const { data, error } = await supabase
      .from('innings_stats')
      .upsert(rows, { onConflict: 'match_id,user_id,innings_number' })
      .select('id');
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ success: true, count: data?.length ?? 0 });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── GET /matches/:id/edit-log ───────────────────────────────────────────────
// The scoring edit log (27 Sep 2026): every edit, delete and undo of this
// match's events, newest first, each as a plain line — "Priya undid: Lions
// point, 3–1 → 2–1". Read-only, and only for the people who run the match —
// its organiser (the creator, or a tournament organiser), its umpire — and
// admins. Everyone else is refused.
export async function getScoringEditLog(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: match } = await supabase
      .from('matches')
      .select('id, sport_id, team_a_name, team_b_name, created_by, umpire_id, tournament_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (!(await canOfficiateMatch(match, userId)) && !(await isAdminUser(userId))) {
      return res.status(403).json({ error: 'Only the organiser, scorer or umpire can see the scoring log.', code: 'NOT_MATCH_OFFICIAL' });
    }
    const { data: rows, error } = await supabase
      .from('match_event_audit')
      .select('id, action, changed_by, created_at, event_id, old_payload, new_payload, score_before, score_after')
      .eq('match_id', id)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    const list = (rows ?? []) as AuditRow[];

    const people = [...new Set(list.map((r) => r.changed_by).filter(Boolean))];
    const { data: users } = people.length
      ? await supabase.from('users').select('id, name').in('id', people)
      : { data: [] as Array<{ id: string; name: string | null }> };
    const nameOf = new Map((users ?? []).map((u: { id: string; name: string | null }) => [u.id, u.name || 'Someone']));

    const sport = normSportSlug((await getSport(match.sport_id as string))?.slug);
    const ctx: LogContext = { sport, teamA: match.team_a_name ?? 'Team A', teamB: match.team_b_name ?? 'Team B' };
    // Cricket: an edited ball still on the match reads "ball 4.3".
    let labels = new Map<string, string>();
    if (sport === 'cricket' && list.some((r) => r.action === 'edit' && r.event_id)) {
      const { data: events } = await supabase
        .from('match_events').select('id, event_type, payload').eq('match_id', id)
        .order('created_at', { ascending: true }).limit(2000);
      labels = cricketBallLabels((events ?? []) as Array<{ id: string; event_type: string; payload?: Record<string, unknown> | null }>);
    }

    const entries = list.map((r) => ({
      id: r.id,
      action: r.action,
      at: r.created_at,
      who: { id: r.changed_by, name: nameOf.get(r.changed_by) ?? 'Someone' },
      text: editLine(r, nameOf.get(r.changed_by) ?? 'Someone', ctx, r.event_id ? labels.get(r.event_id) : null),
    }));
    return res.json({ entries });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
