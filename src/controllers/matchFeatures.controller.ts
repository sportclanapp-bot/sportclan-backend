import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { calculateDLSTarget } from '../utils/dls';
import { aggregatePlayers, isGuestId, recomputeSummary, type CricketPlayerLine } from './scoring.controller';
import { isTerminalMatchStatus } from '../utils/validation';
import { canOfficiateMatch } from '../utils/tournamentAuth';

/**
 * Shared gate for match-mutating feature endpoints (DLS, event edit/delete,
 * innings stats): the caller must be the creator/umpire (SC-42 also adds the
 * missing auth check to DLS/innings which previously had none), and a finished
 * match is immutable (409). Returns { error } to short-circuit, or {} to pass.
 */
async function loadScorableMatch(
  id: string,
  userId: string,
): Promise<{ error?: { status: number; msg: string } }> {
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
    return { error: { status: 409, msg: 'This match is finished and can no longer be modified' } };
  }
  return {};
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 1 — MVP / Player of the Match
// ────────────────────────────────────────────────────────────────────────────

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

  for (const ev of events ?? []) {
    if (slug === 'cricket') break; // handled by the rollup above
    const p: Record<string, unknown> = (ev.payload ?? {}) as Record<string, unknown>;
    // Attribute to the actual player when the scorer credited one; fall back to
    // created_by for legacy/unattributed events.
    const uid = (p.player_id as string) || ev.created_by;
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
  for (const [uid, score] of scores) {
    if (score <= 0) continue; // no contribution → never MVP
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

export async function getMatchMVP(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { data: match } = await supabase
      .from('matches')
      .select('mvp_user_id, score_summary')
      .eq('id', id)
      .maybeSingle();

    // Real-user MVP — resolve the full user (feeds the profile MVP tally).
    if (match?.mvp_user_id) {
      const { data: user } = await supabase
        .from('users')
        .select('id, name, username, profile_picture_url, is_premium')
        .eq('id', match.mvp_user_id)
        .maybeSingle();
      if (user) return res.json({ mvp: { ...user, guest: false } });
    }

    // Guest / name-only MVP (casual matches) — display-only, no users row.
    const gm = (match?.score_summary as { mvp?: { id?: string; name?: string; guest?: boolean } } | null)?.mvp;
    if (gm?.guest && gm.name) {
      return res.json({
        mvp: { id: gm.id, name: gm.name, username: null, profile_picture_url: null, is_premium: false, guest: true },
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

    const { data, error } = await supabase
      .from('match_availability')
      .upsert(
        { match_id: id, user_id: userId, team_id: team_id ?? null, status, updated_at: new Date().toISOString() },
        { onConflict: 'match_id,user_id' },
      )
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
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
    const gate = await loadScorableMatch(id, userId);
    if (gate.error) return res.status(gate.error.status).json({ error: gate.error.msg });

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
    const gate = await loadScorableMatch(id, userId);
    if (gate.error) return res.status(gate.error.status).json({ error: gate.error.msg });

    // Get current event
    const { data: event } = await supabase
      .from('match_events')
      .select('id, payload')
      .eq('id', event_id)
      .eq('match_id', id)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const oldPayload = event.payload ?? {};
    const newPayload = { ...oldPayload, ...changes };

    // Audit log
    await supabase.from('match_event_audit').insert({
      event_id, match_id: id, changed_by: userId,
      old_payload: oldPayload, new_payload: newPayload, action: 'edit',
    });

    // Update event
    await supabase.from('match_events').update({ payload: newPayload }).eq('id', event_id);

    // SC-319: rebuild the canonical score_summary from the full event log so the
    // scoreboard reflects the edit IMMEDIATELY (was stale until the next event).
    // recomputeSummary is stateless — the same recompute undo/completion use.
    const summary = await recomputeSummary(id);

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
    const gate = await loadScorableMatch(id, userId);
    if (gate.error) return res.status(gate.error.status).json({ error: gate.error.msg });

    // Get event for audit
    const { data: event } = await supabase
      .from('match_events')
      .select('id, payload')
      .eq('id', eventId)
      .eq('match_id', id)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Audit log
    await supabase.from('match_event_audit').insert({
      event_id: eventId, match_id: id, changed_by: userId,
      old_payload: event.payload ?? {}, new_payload: {}, action: 'delete',
    });

    // Delete
    await supabase.from('match_events').delete().eq('id', eventId);

    // SC-319: rebuild score_summary from the remaining events (was left stale).
    const summary = await recomputeSummary(id);

    return res.json({ success: true, score_summary: summary });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
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
    const gate = await loadScorableMatch(id, userId);
    if (gate.error) return res.status(gate.error.status).json({ error: gate.error.msg });

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
