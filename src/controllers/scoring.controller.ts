import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { notifyUsers } from '../utils/notify';

// Fire-and-forget: push the big moments of a live match (wickets, goals) to
// every participant in the match. Failures are swallowed — the fan-out must
// never block the scorer's UI.
async function fanoutScoreUpdate(
  matchId: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    const { data: participants } = await supabase
      .from('match_participants')
      .select('user_id')
      .eq('match_id', matchId);
    const userIds = (participants || []).map((p) => p.user_id);
    if (userIds.length === 0) return;
    await notifyUsers(userIds, {
      type: 'score_update',
      title,
      body,
      data: { matchId, screen: 'MatchDetail' },
    });
  } catch {
    // best-effort
  }
}

async function authorizeScorer(matchId: string, userId: string) {
  const { data: match } = await supabase
    .from('matches')
    .select('id, created_by, umpire_id, score_summary, sport_id, status')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return { ok: false as const, status: 404, error: 'Match not found' };
  if (match.created_by !== userId && match.umpire_id !== userId) {
    return { ok: false as const, status: 403, error: 'Only the umpire or creator can score' };
  }
  return { ok: true as const, match };
}

// POST /scoring/:matchId/event
export async function createEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const matchId = String(req.params.matchId);
    const { event_type, period, clock_seconds, payload } = req.body || {};
    if (!event_type) return res.status(400).json({ error: 'event_type is required' });

    const auth = await authorizeScorer(matchId, userId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const match = auth.match;

    // Catch-all: any scored event means the match is in progress, so promote it
    // to `live`. The toss handler already does this for the normal flow; this
    // covers the "skip toss" path where scoring starts without a recorded toss.
    // Guard so we never downgrade a completed/cancelled match.
    if (match.status === 'scheduled' || match.status === 'upcoming') {
      try {
        await supabase.from('matches').update({ status: 'live' }).eq('id', matchId);
      } catch {
        // best-effort — don't block scoring on the status flip
      }
    }

    const { data: event, error } = await supabase
      .from('match_events')
      .insert({
        match_id: matchId,
        event_type,
        period: period ?? null,
        clock_seconds: clock_seconds ?? null,
        payload: payload || {},
        created_by: userId,
      })
      .select('*')
      .single();
    if (error || !event) return res.status(500).json({ error: error?.message || 'Failed to log event' });

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
      if (event_type === 'wicket') {
        const side = (payload?.team_side as string) || 'A';
        const playerName = (payload?.batter_name as string) || (payload?.player_name as string) || 'Batter';
        const runs = payload?.batter_runs ?? payload?.runs_scored ?? '';
        const inning: any = (match.score_summary || {})[side] || {};
        const scoreStr = `${inning.runs ?? 0}/${(inning.wickets ?? 0) + 1}`;
        const teamLabel = `Team ${side}`;
        const title = 'Wicket!';
        const body = runs !== ''
          ? `${playerName} out for ${runs} | ${teamLabel} ${scoreStr}`
          : `${playerName} out | ${teamLabel} ${scoreStr}`;
        void fanoutScoreUpdate(matchId, title, body);
      } else if (event_type === 'goal') {
        const side = (payload?.team_side as string) || 'A';
        const teamLabel = (payload?.team_name as string) || `Team ${side}`;
        const summary: any = match.score_summary || {};
        const a = summary.A?.goals ?? summary.A?.score ?? 0;
        const b = summary.B?.goals ?? summary.B?.score ?? 0;
        const newA = side === 'A' ? a + 1 : a;
        const newB = side === 'B' ? b + 1 : b;
        const title = 'GOAL!';
        const body = `${teamLabel} scores! ${newA}-${newB}`;
        void fanoutScoreUpdate(matchId, title, body);
      }
    } catch {
      // ignore
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
    if (error) return res.status(500).json({ error: error.message });
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
const SET_CONFIG: Record<
  string,
  { target: number; cap?: number; maxSets: number; finalTarget?: number; winBy2: boolean }
> = {
  badminton:   { target: 21, cap: 30, maxSets: 3, winBy2: true },
  tabletennis: { target: 11, maxSets: 5, winBy2: true },
  pickleball:  { target: 11, maxSets: 3, winBy2: true },
  volleyball:  { target: 25, maxSets: 5, finalTarget: 15, winBy2: true },
  carrom:      { target: 25, maxSets: 3, winBy2: false }, // boards to 25, no 2-lead
  // Tennis scored at games→sets granularity (each 'score' event = a game won):
  // 6 games to take a set with a 2-game lead, or 7-6 via the cap (tiebreak),
  // best of 3 sets — consistent with its racket peers (SC-15). Previously tennis
  // was absent here and fell through to the generic flat point tally.
  tennis:      { target: 6, cap: 7, maxSets: 3, winBy2: true },
};

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
  runs: number; balls: number; fours: number; sixes: number;
  out: boolean; dismissal?: string;
  bowl_balls: number; bowl_runs: number; bowl_wickets: number;
}

export function aggregateCricketPlayers(
  events: { event_type: string; payload: any }[],
): Record<string, CricketPlayerLine> {
  const players: Record<string, CricketPlayerLine> = {};
  const ensure = (id: string, side: 'A' | 'B'): CricketPlayerLine => {
    if (!players[id]) {
      players[id] = { side, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, bowl_balls: 0, bowl_runs: 0, bowl_wickets: 0 };
    }
    return players[id]!;
  };
  for (const e of events) {
    const p: any = e.payload || {};
    const batSide: 'A' | 'B' = p.team_side === 'B' ? 'B' : 'A';
    const bowlSide: 'A' | 'B' = batSide === 'A' ? 'B' : 'A';
    const batId: string | undefined = p.batsman_id || p.player_id;
    const bowlId: string | undefined = p.bowler_id;
    if (e.event_type === 'ball') {
      const runs = Number(p.runs ?? 0);
      if (batId) {
        const b = ensure(batId, batSide);
        if (!p.is_extra) b.balls += 1;
        b.runs += runs;
        if (runs === 4) b.fours += 1;
        if (runs === 6) b.sixes += 1;
      }
      if (bowlId) {
        const w = ensure(bowlId, bowlSide);
        if (!p.is_extra) w.bowl_balls += 1;
        w.bowl_runs += runs;
      }
    } else if (e.event_type === 'extra') {
      const runs = Number(p.runs ?? 0);
      const legal = p.type === 'B' || p.type === 'Lb'; // byes/leg-byes are legal balls
      if (batId && legal) ensure(batId, batSide).balls += 1; // ball faced, runs are extras (not the batter's)
      if (bowlId) {
        const w = ensure(bowlId, bowlSide);
        if (legal) w.bowl_balls += 1; // byes/leg-byes NOT charged to the bowler
        else w.bowl_runs += runs;     // wides/no-balls ARE charged to the bowler
      }
    } else if (e.event_type === 'wicket') {
      if (batId) {
        const b = ensure(batId, batSide);
        if (!p.is_extra) b.balls += 1;
        b.out = true;
        b.dismissal = p.wicket_type || p.type || 'out';
      }
      if (bowlId) {
        const w = ensure(bowlId, bowlSide);
        if (!p.is_extra) w.bowl_balls += 1;
        const wt = String(p.wicket_type || p.type || '').toLowerCase().replace(/[^a-z]/g, '');
        // Run-outs / retirements aren't credited to the bowler.
        if (wt !== 'runout' && wt !== 'retired' && wt !== 'retiredhurt') w.bowl_wickets += 1;
      }
    }
  }
  return players;
}

// Recompute a match's score_summary from the authoritative event log, for ALL
// sports, into the canonical shape:
//   { A: { score, …sport detail }, B: { … }, …preserved keys (result/winner_side) }
// `score` is the single cross-sport comparator (cricket: runs; football/hockey:
// goals; basketball: points; rally/carrom: sets/boards won). Recomputing from
// events (rather than incremental updates) means the stored summary can never
// drift out of sync with the events. Used after every scored event, after an
// undo, and at completion. Replaces the old cricket-only recompute.
export async function recomputeSummary(matchId: string): Promise<Record<string, any> | null> {
  const { data: match } = await supabase
    .from('matches').select('sport_id, score_summary').eq('id', matchId).maybeSingle();
  if (!match) return null;
  const { data: sportRow } = await supabase
    .from('sports').select('slug').eq('id', match.sport_id).maybeSingle();
  const slug = sportRow?.slug ?? '';
  const { data: events } = await supabase
    .from('match_events').select('event_type, payload').eq('match_id', matchId)
    .order('created_at', { ascending: true });

  const existing = (match.score_summary as Record<string, any>) || {};
  // Never wipe a pre-existing summary (e.g. seeded/legacy data) when there are
  // no scoring events to recompute from.
  if (!events || events.length === 0) return existing;

  const A: Record<string, any> = { score: 0 };
  const B: Record<string, any> = { score: 0 };
  const sides: Record<'A' | 'B', Record<string, any>> = { A, B };
  const sideOf = (p: any): 'A' | 'B' => ((p?.team_side as 'A' | 'B') === 'B' ? 'B' : 'A');

  if (slug === 'cricket') {
    for (const s of ['A', 'B'] as const) Object.assign(sides[s], { runs: 0, balls: 0, wickets: 0 });
    for (const e of events) {
      const p: any = e.payload || {};
      const inn = sides[sideOf(p)];
      if (e.event_type === 'ball') { inn.runs += Number(p.runs ?? 0); if (!p.is_extra) inn.balls += 1; }
      else if (e.event_type === 'extra') {
        inn.runs += Number(p.runs ?? 0);
        // Byes / leg-byes ARE legal deliveries (the over progresses); wides /
        // no-balls are not. Count the ball accordingly (A5-010/A5-012).
        if (p.type === 'B' || p.type === 'Lb') inn.balls += 1;
      }
      else if (e.event_type === 'wicket') { inn.wickets = Math.min(10, inn.wickets + 1); if (!p.is_extra) inn.balls += 1; }
      inn.score = inn.runs;
    }
  } else if (slug === 'football' || slug === 'hockey') {
    for (const e of events) {
      const p: any = e.payload || {};
      if (e.event_type === 'score' && p.kind === 'goal') sides[sideOf(p)].score += 1;
    }
    A.goals = A.score; B.goals = B.score;
  } else if (slug === 'basketball') {
    for (const e of events) {
      const p: any = e.payload || {};
      if (e.event_type === 'score') sides[sideOf(p)].score += Number(p.value ?? 0);
    }
    A.points = A.score; B.points = B.score;
  } else if (SET_CONFIG[slug]) {
    const cfg = SET_CONFIG[slug];
    let curA = 0, curB = 0, setsA = 0, setsB = 0, period = 1;
    const setScoresA: number[] = [], setScoresB: number[] = [];
    for (const e of events) {
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
      }
    }
    A.score = setsA; B.score = setsB;
    A.sets = setScoresA; B.sets = setScoresB;
    A.points = curA; B.points = curB; // current in-progress set/board
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
  // A5-003/004 · attach the additive per-player rollup for cricket so the
  // scorecard/MVP can read real batting+bowling figures. Side totals (A/B)
  // above are untouched, so results + the A7-002 results surface don't change.
  if (slug === 'cricket') {
    summary.players = aggregateCricketPlayers(events as any[]);
  }
  await supabase
    .from('matches')
    .update({ score_summary: summary, updated_at: new Date().toISOString() })
    .eq('id', matchId);
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
  const rows = Object.entries(players).map(([userId, line]) => ({
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
    bowling_maidens: 0,
    catches: 0,
    runouts: 0,
    stumpings: 0,
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
    const auth = await authorizeScorer(matchId, userId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

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
    if (error) return res.status(500).json({ error: error.message });
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
