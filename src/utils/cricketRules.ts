/**
 * Cricket match rules that depend on how the match was set up — ONE rule for
 * the app and the server (decision A6).
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/cricketRules.ts
 *   server  src/utils/cricketRules.ts
 * and both repos run the same fixture table against it (cricketRules test).
 * Edit both, or neither.
 *
 *   overs     every format takes an overs choice (it used to be Limited only,
 *             so Box and Pair were scored as 20 overs). A match without one —
 *             created before this — plays 20.
 *   all out   one wicket fewer than the players in that side's line-up (a
 *             last batter can't bat alone), at most 10. A side with no line-up
 *             (typed-in teams) is all out at 10, as before.
 */

export type CricketFormat = 'limited' | 'box' | 'pair';

export const DEFAULT_OVERS = 20;
export const DEFAULT_ALL_OUT = 10;

/** The overs each format offers on the create form, and its default. */
export const CRICKET_OVERS: Record<CricketFormat, { options: number[]; standard: number }> = {
  limited: { options: [5, 10, 20, 50], standard: 20 },
  box: { options: [4, 6, 8, 10], standard: 6 },
  pair: { options: [4, 6, 8, 10], standard: 8 },
};

export const CRICKET_FORMAT_LABELS: Record<CricketFormat, string> = {
  limited: 'Limited overs',
  box: 'Box cricket',
  pair: 'Pair (overs match)',
};

/** The overs an innings lasts. */
export function inningsOvers(overs: number | null | undefined): number {
  const n = Math.floor(Number(overs));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_OVERS;
}

/** Wickets that end an innings for a side with `players` in its line-up. */
export function allOutWickets(players: number | null | undefined): number {
  const n = Math.floor(Number(players));
  if (!Number.isFinite(n) || n < 2) return DEFAULT_ALL_OUT;
  return Math.min(n - 1, DEFAULT_ALL_OUT);
}

/** BUILD 3.2: players a side a match can set (above 11: everyone in the squad bats). */
export const PLAYERS_MIN = 2;
export const PLAYERS_MAX = Number.MAX_SAFE_INTEGER; // Stage 13 · CR3 (Dipak): no top

/**
 * Per-side all-out. BUILD 3.2: a match that sets its players a side is all out
 * one wicket short of that number (15 a side → 14); otherwise the line-up
 * decides, as before (rows carrying a team_side; at most 10).
 */
export function allOutBySide(
  lineup: Array<{ team_side?: string | null }> | null | undefined,
  playersPerSide?: number | null,
  lastManStands = false,
): { A: number; B: number } {
  // BUILD 3.3: last man stands — the last batter bats on alone, so a side is
  // all out one wicket later.
  const extra = lastManStands ? 1 : 0;
  const n = Number(playersPerSide);
  if (playersPerSide != null && Number.isInteger(n) && n >= PLAYERS_MIN) return { A: n - 1 + extra, B: n - 1 + extra };
  const count = (s: 'A' | 'B') => (lineup ?? []).filter((p) => p.team_side === s).length;
  return { A: allOutWickets(count('A')) + extra, B: allOutWickets(count('B')) + extra };
}

/** The cricket format of a match from its stored `format` ("T20", "box", "pair"). */
export function cricketFormatOf(format: string | null | undefined): CricketFormat {
  const f = String(format ?? '').trim().toLowerCase();
  if (f === 'box') return 'box';
  if (f === 'pair') return 'pair';
  return 'limited';
}

/** BUILD 3.1: overs are any whole number in this range; the options above are shortcuts. */
export const OVERS_MIN = 1;
export const OVERS_MAX = Number.MAX_SAFE_INTEGER; // Stage 13 · CR3 (Dipak): no top

/**
 * Can a match be played to `overs`? BUILD 3.1: any whole number 1–50 in every
 * format (it was the format's chips only, so a 12-over league game couldn't be
 * set up). The name is kept: it's what create and edit ask.
 */
export function isOfferedOvers(_format: CricketFormat, overs: number | null | undefined): boolean {
  if (overs == null) return true;
  const n = Number(overs);
  return Number.isInteger(n) && n >= OVERS_MIN && n <= OVERS_MAX;
}

/**
 * F-15 · a chase decided by a DLS revised target (the target the chasing side
 * needs to WIN, as the DLS calculator returns it). It was stored and never
 * read, so a rain-shortened chase was still judged on the full first innings.
 *   runs ≥ target        → the chasing side wins (by the wickets in hand)
 *   runs = target − 1    → a tie
 *   fewer                → the side that batted first wins, by
 *                          target − 1 − runs ("won by N runs (DLS)")
 * Null when there is no usable target.
 */
export function dlsOutcome(
  chasingRuns: number,
  dlsTarget: number | null | undefined,
): { winner: 'chaser' | 'defender' | null; runs: number } | null {
  const t = Math.floor(Number(dlsTarget));
  if (!Number.isFinite(t) || t <= 0) return null;
  const r = Math.max(0, Math.floor(Number(chasingRuns) || 0));
  if (r >= t) return { winner: 'chaser', runs: 0 };
  if (r === t - 1) return { winner: null, runs: 0 };
  return { winner: 'defender', runs: t - 1 - r };
}

/**
 * Decisions 2026-09-26 (MATCH_CREATE_TEST_5) · ending a match that is not over.
 *
 * End pressed with the chase unfinished used to award it to the side with more
 * runs, "won by 16 runs" with 23 balls and every wicket left. Now the scorer
 * must choose, and the server refuses an End that doesn't say:
 *   chase under way   award it to the defending side, decide it by DLS, or no result
 *   first innings     award it to either side (a concession), or no result
 * "No result" is an abandonment (it counts for nobody); the other two complete
 * the match. A match whose chase is over needs no choice.
 */
export type UnfinishedEnd = 'award' | 'dls' | 'no_result';
export type CricketStage = 'first_innings' | 'chase' | 'over';

export interface InningsFacts {
  runs: number;
  wickets: number;
  balls: number;
  declared?: boolean;
}

/** Is an innings finished — out of overs, all out, or declared? */
export function inningsFinished(inn: InningsFacts, overs: number | null | undefined, allOut: number): boolean {
  return inn.declared === true || inn.balls >= inningsOvers(overs) * 6 || inn.wickets >= allOut;
}

/** Where a match stands. The chase target is the DLS one when set. */
export function cricketStage(args: {
  first: InningsFacts;
  chase: InningsFacts;
  overs: number | null | undefined;
  firstAllOut: number;
  chaseAllOut: number;
  dlsTarget?: number | null;
}): CricketStage {
  if (!inningsFinished(args.first, args.overs, args.firstAllOut)) return 'first_innings';
  const dls = Math.floor(Number(args.dlsTarget));
  const target = Number.isFinite(dls) && dls > 0 ? dls : args.first.runs + 1;
  const over = args.chase.runs >= target
    || args.chase.wickets >= args.chaseAllOut
    || args.chase.balls >= inningsOvers(args.overs) * 6;
  return over ? 'over' : 'chase';
}

/** The ends a scorer may pick at this stage; none once the match is over. */
export function unfinishedEnds(stage: CricketStage): UnfinishedEnd[] {
  if (stage === 'chase') return ['award', 'dls', 'no_result'];
  if (stage === 'first_innings') return ['award', 'no_result'];
  return [];
}

/** May this side be awarded the match? In a chase, only the defending side. */
export function awardAllowed(stage: CricketStage, winner: 'A' | 'B' | null | undefined, defendingSide: 'A' | 'B'): boolean {
  if (winner !== 'A' && winner !== 'B') return false;
  if (stage === 'chase') return winner === defendingSide;
  return stage === 'first_innings';
}

/**
 * Retired hurt is not a dismissal (2026-09-26, after MATCH_CREATE_TEST_5). The
 * batter leaves, a new batter comes in, and the retired batter may come back
 * later in the innings; on the scorecard they are "retired hurt", not out. It
 * does not count toward all out, the bowler's wickets, or "won by N wickets".
 * Retired OUT is a dismissal (a wicket, credited to no bowler).
 * Every other wicket kind — and an old wicket with no kind — is a dismissal.
 */
export function isDismissal(wicketType: unknown): boolean {
  const k = String(wicketType ?? '').toLowerCase().replace(/[^a-z]/g, '');
  // BUILD 3.4: retired not out (the retire-at-N rule) is not a dismissal either.
  return k !== 'retiredhurt' && k !== 'retirednotout';
}

/** BUILD 3.4: a retire-at-N match's range (off = null). */
export const RETIRE_MIN = 1; // Stage 13 · CR3: any number of runs, 1 or more
export const RETIRE_MAX = Number.MAX_SAFE_INTEGER;

/** BUILD 3.5: the limit the form suggests for max overs per bowler — ⌈overs / 5⌉. */
export function suggestedBowlerOvers(overs: number): number {
  return Math.max(1, Math.ceil(overs / 5));
}

/** BUILD 3.5: a bowler who has bowled their quota (legal balls) can't bowl again this innings. */
export function bowlerQuotaDone(bowlBalls: number | null | undefined, bowlerOvers: number | null | undefined): boolean {
  return !!bowlerOvers && (bowlBalls ?? 0) >= bowlerOvers * 6;
}

/** BUILD 3.6: a wide / no-ball's penalty runs — 0 to 2 (1 is the Laws' and the standard). */
export const EXTRA_RUNS_MIN = 0;
export const EXTRA_RUNS_MAX = Number.MAX_SAFE_INTEGER; // Stage 13 · CR3: the organiser's own value

/**
 * BUILD 3.6: the penalty a wide / no-ball carried. The app stores it on the
 * event (`penalty`), so the event reads the same whatever the match's rules
 * say later; an event from before this carried 1.
 */
export function extraPenaltyOf(payload: unknown): number {
  const n = (payload as { penalty?: unknown } | null | undefined)?.penalty;
  // Stage 13 · CR3: any whole number of runs (no top); anything else is the Laws' 1.
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 1;
}

/**
 * A ball of the over — one the over counts. A ball or a wicket unless marked
 * `is_extra`; a bye or leg-bye; a wide or no-ball only when it is not
 * re-bowled (BUILD 3.7: the event says `rebowl: false`).
 */
export function isBallOfOver(eventType: unknown, payload: unknown): boolean {
  const p = (payload ?? {}) as { is_extra?: unknown; type?: unknown; rebowl?: unknown };
  if (eventType === 'extra') return p.type === 'B' || p.type === 'Lb' || ((p.type === 'Wd' || p.type === 'Nb') && p.rebowl === false);
  if (eventType === 'ball' || eventType === 'wicket') return !p.is_extra;
  return false;
}

/**
 * BUILD 3.8 · free hit: is the next delivery of `side`'s innings a free hit?
 * A no-ball makes it one; a wide bowled again carries it on; any other ball of
 * the over (the free hit itself) uses it up. `events` in the order bowled.
 */
export function freeHitNext(events: ReadonlyArray<{ event_type: string; payload?: unknown }>, side: 'A' | 'B'): boolean {
  let free = false;
  for (const ev of events) {
    const p = (ev.payload ?? {}) as { team_side?: unknown; type?: unknown };
    if ((p.team_side === 'B' ? 'B' : 'A') !== side) continue;
    if (ev.event_type === 'extra' && p.type === 'Nb') free = true;
    else if (isBallOfOver(ev.event_type, ev.payload)) free = false;
  }
  return free;
}

/** BUILD 3.8: a wicket a free hit allows — out only as off a no-ball; a retirement is no delivery, so always. */
const FREE_HIT_OUTS = new Set(['runout', 'obstructingthefield', 'hittheballtwice', 'handledtheball']);
export function allowedOnFreeHit(wicketType: unknown): boolean {
  const k = String(wicketType ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return FREE_HIT_OUTS.has(k) || !isDismissal(k) || k === 'retiredout';
}

/**
 * BUILD 3.9 · super over: a knockout match that ends level is decided by one
 * (a bracket can't advance on a tie). It is recorded as its score — each side's
 * runs, whole numbers that differ; a super over that ties is played again, and
 * the one that decided it is what's entered.
 */
export const SUPER_OVER_MAX = Number.MAX_SAFE_INTEGER; // Stage 13 · CR3: no top
export function validSuperOver(a: unknown, b: unknown): boolean {
  const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= SUPER_OVER_MAX;
  return ok(a) && ok(b) && a !== b;
}
export function superOverWinner(a: number, b: number): 'A' | 'B' {
  return a > b ? 'A' : 'B';
}
/** "Lions won the super over (14–9)". */
export function superOverResultText(winnerName: string, so: { A: number; B: number }): string {
  return `${winnerName} won the super over (${Math.max(so.A, so.B)}–${Math.min(so.A, so.B)})`;
}

/** BUILD 3.10: an innings time cap's range in minutes (off = null). Display and warning only. */
export const INNINGS_MINUTES_MIN = 1; // Stage 13 · CR3: any time, 1 minute or more
export const INNINGS_MINUTES_MAX = Number.MAX_SAFE_INTEGER;

/**
 * BUILD 3.10 · how long `side`'s innings has run: from its first delivery to
 * `now`. Null before it starts. `warn` from 5 minutes before the cap, `over`
 * once it's reached — the pad says so; nothing is enforced.
 */
export function inningsClock(
  events: ReadonlyArray<{ event_type: string; payload?: unknown; created_at?: string | null }>,
  side: 'A' | 'B',
  capMinutes: number | null | undefined,
  nowMs: number,
): { elapsed: number; cap: number; warn: boolean; over: boolean } | null {
  if (!capMinutes) return null;
  const first = events.find((ev) =>
    (ev.event_type === 'ball' || ev.event_type === 'extra' || ev.event_type === 'wicket')
    && ((ev.payload as { team_side?: unknown } | undefined)?.team_side === 'B' ? 'B' : 'A') === side);
  const start = first?.created_at ? Date.parse(first.created_at) : NaN;
  if (!Number.isFinite(start)) return null;
  const elapsed = Math.max(0, Math.floor((nowMs - start) / 60000));
  return { elapsed, cap: capMinutes, warn: elapsed >= capMinutes - 5, over: elapsed >= capMinutes };
}

/**
 * BUILD 3.12 · reduce overs mid-match (rain, light): both sides get the same,
 * fewer overs — an equal cut, as local cricket does, not DLS. Why `to` can't be
 * the match's new overs, or null. `firstDone`: the first innings is over (the
 * chase has started); its balls may then be fewer than the cut (all out), but
 * not more — that is a chase-only cut, which is what DLS is for.
 */
export function reduceOversRefusal(args: { from: number; to: unknown; firstBalls: number; firstDone: boolean; chaseBalls: number }): string | null {
  const { from, to } = args;
  if (typeof to !== 'number' || !Number.isInteger(to) || to < OVERS_MIN || to >= from) {
    return `Reduce to a whole number of overs below ${from}.`;
  }
  if (args.firstDone && args.firstBalls > to * 6) {
    return `The first innings already had more than ${to} overs. Both sides must get the same — cut the chase with the DLS calculator instead.`;
  }
  const bowled = Math.max(args.firstDone ? 0 : args.firstBalls, args.chaseBalls);
  if (bowled > to * 6) {
    const least = Math.ceil(bowled / 6);
    return `${least === 1 ? 'Part of an over has' : `More than ${least - 1} overs have`} been bowled already — reduce to ${least} or more.`;
  }
  return null;
}

/** BUILD 3.12: the overs a match had before they were reduced, or null. */
export function oversReducedFrom(summary: unknown): number | null {
  const from = (summary as { overs_reduced?: { from?: unknown } } | null | undefined)?.overs_reduced?.from;
  return typeof from === 'number' && from > 0 ? from : null;
}

/**
 * BUILD 3.13 · powerplay (display only): the first `overs` overs of an innings.
 * Where `side`'s innings stands against it — its runs and wickets in those
 * overs, whether it is running now (and which over), and whether it's done.
 */
export function powerplayState(
  events: ReadonlyArray<{ event_type: string; payload?: unknown }>,
  side: 'A' | 'B',
  overs: number | null | undefined,
): { runs: number; wickets: number; overNow: number; overs: number; running: boolean; done: boolean } | null {
  if (!overs) return null;
  const limit = overs * 6;
  let balls = 0;
  let runs = 0;
  let wickets = 0;
  for (const ev of events) {
    const p = (ev.payload ?? {}) as { team_side?: unknown; runs?: unknown; wicket_type?: unknown; type?: unknown };
    if ((p.team_side === 'B' ? 'B' : 'A') !== side) continue;
    if (ev.event_type !== 'ball' && ev.event_type !== 'extra' && ev.event_type !== 'wicket') continue;
    if (balls >= limit) break;
    runs += Math.max(0, Number(p.runs ?? 0) || 0) + penaltyRunsOf(p); // BUILD 3.14: a roof penalty
    if (ev.event_type === 'wicket' && isDismissal(p.wicket_type ?? p.type)) wickets += 1;
    if (isBallOfOver(ev.event_type, ev.payload)) balls += 1;
  }
  return { runs, wickets, overNow: Math.min(overs, Math.floor(balls / 6) + 1), overs, running: balls < limit, done: balls >= limit };
}

/**
 * BUILD 3.14 · box cricket: hitting the roof costs the batting side runs (−5).
 * Stored on the ball as `penalty_runs` (a whole number, −1 or less): the side's
 * total takes it; the batter and the bowler don't. 0 on any other event.
 */
export const ROOF_PENALTY = -5;
export function penaltyRunsOf(payload: unknown): number {
  const n = (payload as { penalty_runs?: unknown } | null | undefined)?.penalty_runs;
  return typeof n === 'number' && Number.isInteger(n) && n <= -1 ? n : 0; // Stage 13 · CR3: any penalty
}

// ─── Cricket gap 5 (5 Oct 2026) · a score typed in, not ball by ball ────────
// A tournament where nobody scores on a phone still wants NRR. The organiser
// types each side's runs, wickets and overs (and who batted first); completion
// stores it marked `score_only`. Overs are cricket's o.b (12.3 = 12 overs and
// 3 balls). A chase stops once the target is passed, so the side batting
// second can't have more than the target plus a last-ball no-ball six (7).

export const TYPED_RUNS_MAX = Number.MAX_SAFE_INTEGER; // Stage 13 · CR3: no top

/** Balls from o.b overs (12.3 → 75), or null when it isn't valid o.b. */
export function typedOversToBalls(x: unknown): number | null {
  const s = typeof x === 'number' ? String(x) : typeof x === 'string' ? x.trim() : '';
  if (!/^\d{1,6}(\.\d)?$/.test(s)) return null; // Stage 13 · CR3: any overs (was 99.5)
  const [w, b = '0'] = s.split('.');
  const balls = Number(b);
  if (balls > 5) return null;
  return Number(w) * 6 + balls;
}

export interface TypedInnings { runs: unknown; wickets: unknown; overs: unknown; allOut?: unknown }

/** Why a typed score can't be stored, and which field, or null. */
export function typedScoreRefusal(
  a: TypedInnings, b: TypedInnings,
  opts: { overs: number | null; allOut: { A: number; B: number }; firstBatting: unknown },
): { error: string; field: string } | null {
  if (opts.firstBatting !== 'A' && opts.firstBatting !== 'B') return { error: 'Say which side batted first.', field: 'first_batting_side' };
  const sides = [['A', a], ['B', b]] as const;
  for (const [s, x] of sides) {
    const runs = Number(x.runs);
    if (x.runs === '' || x.runs == null || !Number.isInteger(runs) || runs < 0 || runs > TYPED_RUNS_MAX) {
      return { error: 'Runs must be a whole number, 0 or more.', field: `${s}.runs` };
    }
    const w = Number(x.wickets);
    if (x.wickets === '' || x.wickets == null || !Number.isInteger(w) || w < 0 || w > opts.allOut[s]) {
      return { error: `Wickets must be a whole number from 0 to ${opts.allOut[s]}.`, field: `${s}.wickets` };
    }
    if (x.allOut != null && typeof x.allOut !== 'boolean') return { error: 'All out is yes or no.', field: `${s}.allOut` };
    const balls = typedOversToBalls(x.overs);
    if (balls == null) return { error: 'Overs are written like 12.3 — whole overs, then 0 to 5 balls.', field: `${s}.overs` };
    if (balls === 0 && (runs > 0 || w > 0)) return { error: 'A side that scored runs or lost wickets faced at least one ball.', field: `${s}.overs` };
    if (opts.overs != null && balls > opts.overs * 6) return { error: `No side can bat more than the match's ${opts.overs} overs.`, field: `${s}.overs` };
  }
  // Stage 13 · CR3: no top on the chase (was first innings + 7) — a ball's runs have no top
  // (all-run overthrows, a wide worth the match's own number), so the last ball can pass the target by any amount.
  return null;
}

/** Who won a typed score: more runs; null when level. */
export function typedScoreWinner(a: { runs: unknown }, b: { runs: unknown }): 'A' | 'B' | null {
  const ra = Number(a.runs), rb = Number(b.runs);
  return ra > rb ? 'A' : rb > ra ? 'B' : null;
}

// ─── Cricket gap 9 (5 Oct 2026) · a super over scored ball by ball ──────────
// A tied knockout is decided by super overs scored on the pad: each event
// carries payload.super_over = 1, 2, … . They never count in the match's own
// innings, player stats or NRR. One over a side, two wickets and the side is
// out. The side that batted second bats first; in a second super over, the side
// that batted second in the one before. Level again → another super over.

export const SUPER_OVER_BALLS = 6;
export const SUPER_OVER_ALL_OUT = 2;

type Ev = { event_type: string; payload?: unknown };
type P = Record<string, unknown>;

/** The super over an event belongs to (1, 2, …), or 0 for the match itself. */
export function superOverNumber(payload: unknown): number {
  const n = (payload as P | null | undefined)?.super_over;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 0;
}

/** The match's own events — what its innings, stats and NRR are made of. */
export function mainEvents<T extends Ev>(events: readonly T[]): T[] {
  return events.filter((e) => superOverNumber(e.payload) === 0);
}

/** One side's runs, legal balls and wickets in these events — the server's own sums. */
export function sideTotals(events: readonly Ev[], side: 'A' | 'B', allOut: number): { runs: number; balls: number; wickets: number } {
  const t = { runs: 0, balls: 0, wickets: 0 };
  for (const e of events) {
    const p = (e.payload ?? {}) as P;
    if ((p.team_side === 'B' ? 'B' : 'A') !== side) continue;
    if (e.event_type === 'ball') { t.runs += Number(p.runs ?? 0) + penaltyRunsOf(p); if (!p.is_extra) t.balls += 1; }
    else if (e.event_type === 'extra') { t.runs += Number(p.runs ?? 0); if (isBallOfOver('extra', p)) t.balls += 1; }
    else if (e.event_type === 'wicket') { if (isDismissal((p.wicket_type ?? p.type) as string)) t.wickets = Math.min(allOut, t.wickets + 1); if (!p.is_extra) t.balls += 1; }
  }
  return t;
}

export interface SuperOverState {
  n: number;
  /** Who bats first in it. */
  first: 'A' | 'B';
  A: { runs: number; balls: number; wickets: number };
  B: { runs: number; balls: number; wickets: number };
  /** Both sides have batted (an over, two wickets, or the target passed). */
  done: boolean;
  /** The side with more runs once done; null while playing or when level. */
  winner: 'A' | 'B' | null;
}

const ended = (t: { balls: number; wickets: number }) => t.balls >= SUPER_OVER_BALLS || t.wickets >= SUPER_OVER_ALL_OUT;

/**
 * Every super over played so far, in order. `matchFirst` is the side that
 * batted first in the match (the other bats first in super over 1).
 */
export function superOversOf(events: readonly Ev[], matchFirst: 'A' | 'B'): SuperOverState[] {
  const max = events.reduce((m, e) => Math.max(m, superOverNumber(e.payload)), 0);
  const out: SuperOverState[] = [];
  let firstOfNext: 'A' | 'B' = matchFirst === 'A' ? 'B' : 'A';
  for (let n = 1; n <= max; n++) {
    const evs = events.filter((e) => superOverNumber(e.payload) === n);
    const first = firstOfNext;
    const second = first === 'A' ? 'B' : 'A';
    const A = sideTotals(evs, 'A', SUPER_OVER_ALL_OUT);
    const B = sideTotals(evs, 'B', SUPER_OVER_ALL_OUT);
    const f = first === 'A' ? A : B, s = second === 'A' ? A : B;
    const done = ended(f) && (ended(s) || s.runs > f.runs);
    const winner = done && A.runs !== B.runs ? (A.runs > B.runs ? 'A' : 'B') : null;
    out.push({ n, first, A, B, done, winner });
    firstOfNext = second; // ICC: the side that batted second bats first next time
  }
  return out;
}

const ORD = ['', '', '2nd ', '3rd ', '4th ', '5th '];
/** "Lions won the super over (14–9)", "Lions won the 2nd super over (8–6)". */
export function superOverPlayedText(winnerName: string, so: SuperOverState): string {
  const w = so.winner === 'A' ? so.A.runs : so.B.runs;
  const l = so.winner === 'A' ? so.B.runs : so.A.runs;
  return `${winnerName} won the ${ORD[so.n] ?? `${so.n}th `}super over (${w}–${l})`;
}

/** Cricket gap 9: how a tied knockout is settled when no (more) super overs can be played. */
export type TieFallback = 'seed' | 'boundaries' | 'toss';
export const TIE_FALLBACKS: readonly TieFallback[] = ['seed', 'boundaries', 'toss'];

/** Fours and sixes off the bat for each side, in these events (the match and its super overs). */
export function boundariesOf(events: readonly Ev[]): { A: number; B: number } {
  const out = { A: 0, B: 0 };
  for (const e of events) {
    if (e.event_type !== 'ball') continue;
    const p = (e.payload ?? {}) as P;
    const r = Number(p.runs ?? 0);
    if (r === 4 || r === 6) out[p.team_side === 'B' ? 'B' : 'A'] += 1;
  }
  return out;
}

/** "Lions went through on boundaries (14–11)", "… as the higher seed", "Lions won the toss". */
export function tieFallbackText(winnerName: string, how: TieFallback, b?: { w: number; l: number }): string {
  if (how === 'boundaries') return `${winnerName} went through on boundaries${b ? ` (${b.w}–${b.l})` : ''}`;
  if (how === 'toss') return `${winnerName} won the toss`;
  return `${winnerName} went through as the higher seed`;
}

// ─── Stage 15 follow-up · a best-of-N cricket series (the BB6 / CH7 series engine) ───
//
// One fixture, several full matches. Each game's deliveries carry `game: n`
// (untagged = game 1); a game ends with a note { kind: 'game_end', game: n,
// winner: 'A' | 'B' | null, next_first?: 'A' | 'B' } — the winner from its
// result (a super over, an award), and who bats first in the next game.

/** The game a cricket event belongs to (1 when untagged). */
export function cricketGameOf(payload: unknown): number {
  const n = (payload as P | null | undefined)?.game;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 1;
}

export type CricketGameEnd = { game: number; winner: 'A' | 'B' | null; nextFirst: 'A' | 'B' | null };

/** The series so far: each finished game, games won, the game in play, and the winner once a side has a majority of `games`. */
export function cricketSeries(events: readonly Ev[], games: number): {
  ends: CricketGameEnd[]; wonA: number; wonB: number; current: number; decided: 'A' | 'B' | null; need: number;
} {
  const ends: CricketGameEnd[] = [];
  for (const e of events) {
    const p = (e.payload ?? {}) as P;
    if (e.event_type !== 'note' || p.kind !== 'game_end') continue;
    ends.push({ game: ends.length + 1, winner: p.winner === 'A' || p.winner === 'B' ? p.winner : null, nextFirst: p.next_first === 'A' || p.next_first === 'B' ? p.next_first : null });
  }
  const need = Math.floor(games / 2) + 1;
  const wonA = ends.filter((x) => x.winner === 'A').length; const wonB = ends.filter((x) => x.winner === 'B').length;
  const decided = wonA >= need ? 'A' : wonB >= need ? 'B' : null;
  return { ends, wonA, wonB, current: decided ? ends.length : Math.min(games, ends.length + 1), decided, need };
}

/** One game's events (its deliveries and its super overs), without the game-end notes. */
export function cricketGameEvents<T extends Ev>(events: readonly T[], game: number): T[] {
  return events.filter((e) => cricketGameOf(e.payload) === game && !(e.event_type === 'note' && (e.payload as P | null | undefined)?.kind === 'game_end'));
}
