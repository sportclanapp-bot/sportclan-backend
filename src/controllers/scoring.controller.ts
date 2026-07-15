import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { normalizeClientKey } from '../utils/idempotency';
import { notifyUsers } from '../utils/notify';
import { isTerminalMatchStatus } from '../utils/validation';
import { canOfficiateMatch } from '../utils/tournamentAuth';

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

async function authorizeScorer(matchId: string, userId: string) {
  const { data: match } = await supabase
    .from('matches')
    .select('id, created_by, umpire_id, score_summary, sport_id, status, is_ranked, tournament_id')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return { ok: false as const, status: 404, error: 'Match not found' };
  if (!(await canOfficiateMatch(match, userId))) {
    return { ok: false as const, status: 403, error: match.tournament_id ? 'Only a tournament organiser or the umpire can score' : 'Only the umpire or creator can score' };
  }
  return { ok: true as const, match };
}

// POST /scoring/:matchId/event
export async function createEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const matchId = String(req.params.matchId);
    const { event_type, period, clock_seconds, payload, idempotency_key } = req.body || {};
    if (!event_type) return res.status(400).json({ error: 'event_type is required' });

    const auth = await authorizeScorer(matchId, userId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const match = auth.match;

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
      if (outOfRange(payload.value, 1, 3)) {
        return res.status(400).json({ error: 'value must be an integer between 1 and 3' });
      }
      if (outOfRange(payload.runs, 0, 7)) {
        return res.status(400).json({ error: 'runs must be an integer between 0 and 7' });
      }
    }

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
    }

    // SC-113: atomic, race-safe insert. record_match_event serializes per-match
    // (advisory lock) and dedupes a rapid/concurrent IDENTICAL submit (double-tap
    // / retry) → exactly one event, so recomputeSummary can't inflate the score.
    // Falls back to the direct insert until migration 049 (the RPC) is applied,
    // so deploying this ahead of the migration is safe (pre-fix behaviour).
    let event: any = null;
    let error: any = null;
    let wasNew = true; // SC-133: only fan out for a genuinely NEW event (056 reports it)
    const baseArgs = {
      p_match_id: matchId,
      p_created_by: userId,
      p_event_type: event_type,
      p_period: period ?? null,
      p_clock_seconds: clock_seconds ?? null,
      p_payload: payload || {},
    };
    // SC-129: pass the per-tap idempotency key so a slow (>3s) retry maps to the
    // existing event. Fallback ladder keeps the 3s dedup active with no regression
    // window: 8-arg (with p_client_key) → PGRST202 → 7-arg (the 049 function still
    // runs its 3s dedup pre-055) → PGRST202 → last-resort direct insert.
    // SC-179: coerce a non-UUID key to null so a malformed key can't 500 scoring.
    let rpc = await supabase.rpc('record_match_event', { ...baseArgs, p_client_key: normalizeClientKey(idempotency_key) });
    if (rpc.error && rpc.error.code === 'PGRST202') {
      rpc = await supabase.rpc('record_match_event', baseArgs);
    }
    if (rpc.error && rpc.error.code === 'PGRST202') {
      // Neither RPC signature present — last-resort direct insert (no dedup, no client_key column).
      const ins = await supabase
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
      event = ins.data;
      error = ins.error;
    } else {
      // SC-133: 056 returns { event, was_new }; 055 (+ the 7-arg fallback) returns a
      // raw match_events row → treat a row as was_new=true (today's behaviour).
      const d = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      if (d && typeof d === 'object' && 'was_new' in d) {
        event = (d as any).event;
        wasNew = (d as any).was_new;
      } else {
        event = d;
        wasNew = true;
      }
      error = rpc.error;
    }
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
          const playerName =
            (payload?.batter_name as string) || (payload?.player_name as string) || 'Batter';
          const runs = payload?.batter_runs ?? payload?.runs_scored ?? '';
          const inning: any = summary[side] || {};
          const scoreStr = `${inning.runs ?? 0}/${inning.wickets ?? 0}`;
          const title = 'Wicket!';
          const body =
            runs !== ''
              ? `${playerName} out for ${runs} | ${teamName(side)} ${scoreStr}`
              : `${playerName} out | ${teamName(side)} ${scoreStr}`;
          void fanoutScoreUpdate(matchId, title, body, userId);
        } else {
          // generic score / goal — points or goals across all other sports.
          // Rally-family sports (badminton/TT/volleyball/pickleball/tennis) keep
          // the live running count in `points` (their `score` is sets-won, 0
          // early game); football goals / basketball points keep it in
          // `score`/`goals`.
          const val = (s: any) => {
            if (!s) return 0;
            if (Array.isArray(s.sets)) return s.points ?? 0;
            return s.score ?? s.goals ?? s.points ?? 0;
          };
          const title = payload?.kind === 'goal' ? 'GOAL!' : 'Score!';
          const body = `${teamName(side)} scores! ${val(summary.A)}-${val(summary.B)}`;
          void fanoutScoreUpdate(matchId, title, body, userId);
        }
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
  name?: string; // SC-14/guest: display name captured from the event payload
  runs: number; balls: number; fours: number; sixes: number;
  out: boolean; dismissal?: string;
  bowl_balls: number; bowl_runs: number; bowl_wickets: number;
}

export function aggregateCricketPlayers(
  events: { event_type: string; payload: any }[],
): Record<string, CricketPlayerLine> {
  const players: Record<string, CricketPlayerLine> = {};
  const ensure = (id: string, side: 'A' | 'B', name?: string): CricketPlayerLine => {
    if (!players[id]) {
      players[id] = { side, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, bowl_balls: 0, bowl_runs: 0, bowl_wickets: 0 };
    }
    // First non-empty name wins — lets the scorecard/MVP resolve a real name
    // straight from the rollup (fixes SC-52) and names guest players too.
    if (name && !players[id]!.name) players[id]!.name = name;
    return players[id]!;
  };
  for (const e of events) {
    const p: any = e.payload || {};
    const batSide: 'A' | 'B' = p.team_side === 'B' ? 'B' : 'A';
    const bowlSide: 'A' | 'B' = batSide === 'A' ? 'B' : 'A';
    const batId: string | undefined = p.batsman_id || p.player_id;
    const bowlId: string | undefined = p.bowler_id;
    const batName: string | undefined = p.batsman_name || p.player_name;
    const bowlName: string | undefined = p.bowler_name;
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
      if (bowlId) {
        const w = ensure(bowlId, bowlSide, bowlName);
        if (legal) w.bowl_balls += 1; // byes/leg-byes NOT charged to the bowler
        else w.bowl_runs += runs;     // wides/no-balls ARE charged to the bowler
      }
    } else if (e.event_type === 'wicket') {
      if (batId) {
        const b = ensure(batId, batSide, batName);
        if (!p.is_extra) b.balls += 1;
        b.out = true;
        b.dismissal = p.wicket_type || p.type || 'out';
      }
      if (bowlId) {
        const w = ensure(bowlId, bowlSide, bowlName);
        if (!p.is_extra) w.bowl_balls += 1;
        const wt = String(p.wicket_type || p.type || '').toLowerCase().replace(/[^a-z]/g, '');
        // Run-outs / retirements aren't credited to the bowler.
        if (wt !== 'runout' && wt !== 'retired' && wt !== 'retiredhurt') w.bowl_wickets += 1;
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
export interface GoalPlayerLine { side: 'A' | 'B'; name?: string; goals: number; assists: number }
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
    if (!isGoal && !isAssist) continue;
    const line = (players[id] ??= { side: sideOfPayload(p), goals: 0, assists: 0 });
    if (!line.name) { const nm = nameFromPayload(p); if (nm) line.name = nm; }
    if (isGoal) line.goals += 1;
    if (isAssist) line.assists += 1;
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
export async function recomputeSummary(matchId: string): Promise<Record<string, any> | null> {
  const { data: match } = await supabase
    .from('matches').select('sport_id, score_summary, format').eq('id', matchId).maybeSingle();
  if (!match) return null;
  const { data: sportRow } = await supabase
    .from('sports').select('slug').eq('id', match.sport_id).maybeSingle();
  // Normalise the slug so hyphenated/underscored slugs (e.g. 'table-tennis')
  // match the single-token keys in SET_CONFIG / the family checks below.
  // Previously 'table-tennis' fell through to the generic point tally instead
  // of set scoring — the same class of gap as SC-15 (tennis).
  const slug = (sportRow?.slug ?? '').toLowerCase().replace(/[-_\s]/g, '');
  const { data: events } = await supabase
    .from('match_events').select('event_type, payload, clock_seconds, period').eq('match_id', matchId)
    .order('created_at', { ascending: true });

  const existing = (match.score_summary as Record<string, any>) || {};
  // Never wipe a pre-existing summary (e.g. seeded/legacy data) when there are
  // no scoring events to recompute from.
  if (!events || events.length === 0) return existing;

  const A: Record<string, any> = { score: 0 };
  const B: Record<string, any> = { score: 0 };
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
