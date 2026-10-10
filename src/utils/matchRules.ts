/**
 * Match rules as data — ONE definition for the app and the server (BUILD 2.1).
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/matchRules.ts
 *   server  src/utils/matchRules.ts
 * and the app's matchRulesParity test fails if they differ. Edit both, or
 * neither.
 *
 * A match's rules used to live in one 20-character `format` string whose
 * meaning changed by sport ("T20", "bo3", "Blitz · 5+0") plus `overs` for
 * cricket. They now live in `matches.rules` (migration 114) as one versioned
 * object. `format` / `overs` are still written, kept in step, because older
 * apps read them.
 *
 * A match stored before this (rules = null) plays exactly as it did: its rules
 * are read back from `format` / `overs` by rulesFromLegacy.
 */
import { SERIES_SPORTS, TIE_SPORTS, tieNeed as tieNeedOf, tieSpecProblem, tieWeighted, type TieSpec } from './tieCore';
import { MATCH_LENGTHS, bestOfFor, lengthKey } from './matchLength';
import { OVERS_MIN, PLAYERS_MIN, PLAYERS_MAX, RETIRE_MIN, RETIRE_MAX, EXTRA_RUNS_MIN, EXTRA_RUNS_MAX, INNINGS_MINUTES_MIN, INNINGS_MINUTES_MAX, isOfferedOvers } from './cricketRules';

export const RULES_VERSION = 1;

export type CricketStyle = 'limited' | 'box' | 'pair';

/** Every field is optional in the type; a sport uses the ones in its standard. */
export interface MatchRules {
  v: 1;
  /** Cricket: limited overs / box / pair, and overs per innings. */
  style?: CricketStyle;
  overs?: number;
  /** Players a side. Cricket (3.2): null = the line-up decides; all out one short of it. Football (3.16): 3–11, shown as "7-a-side". */
  players?: number | null;
  /** BUILD 3.3: last man stands — the last batter bats on alone. */
  lastManStands?: boolean;
  /** BUILD 3.4: a batter retires (not out, may return) on reaching this many runs; null = off. */
  retireAt?: number | null;
  /** BUILD 3.5: the most overs one bowler may bowl in an innings; null = no limit. */
  bowlerOvers?: number | null;
  /** BUILD 3.6: penalty runs for a wide or a no-ball (0–2; the Laws say 1). */
  extraRuns?: number;
  /** BUILD 3.7: a wide / no-ball is bowled again (true, the Laws) or counts as a ball of the over. */
  rebowl?: boolean;
  /** BUILD 3.8: the delivery after a no-ball is a free hit (out only as off a no-ball). */
  freeHit?: boolean;
  /** BUILD 3.10: minutes an innings should take (display and warning only); null = off. */
  inningsMinutes?: number | null;
  /** BUILD 3.13: powerplay overs at the start of each innings (display only); null = none. */
  powerplayOvers?: number | null;
  /** BUILD 3.15: gully cricket — caught one-handed off one bounce is out; a six is out. */
  oneTipOneHand?: boolean;
  sixAndOut?: boolean;
  /** Cricket gap 1 (5 Oct 2026): tennis-ball and box cricket play no LBW. On: LBW is not a way out. */
  noLbw?: boolean;
  /** Best-of sports: games / sets / boards the match is best of. */
  bestOf?: number;
  /** Rally and carrom: points to win a game, the hard cap (null = none), the
   *  deciding game's target (null = same), and whether a 2-point lead is needed. */
  target?: number;
  cap?: number | null;
  finalTarget?: number | null;
  winBy2?: boolean;
  /**
   * Stage 10 · TT5 · play every game of the match (a "3 games, all played"
   * league match — UTT, TTSL): the match goes to the side with more games, and
   * each game counts on its own. Badminton, table tennis, pickleball, volleyball.
   */
  allGames?: boolean;
  /** Timed team sports: regulation periods, and minutes each (null = untimed). */
  periods?: number;
  periodMinutes?: number | null;
  /** BUILD 3.17: football's half-time in minutes (display only); null = not set. */
  halfTimeMinutes?: number | null;
  /** BUILD 3.18: football's penalties, kicks each before sudden death (3 or 5). */
  penaltyKicks?: number;
  /** BUILD 3.19: a level knockout plays extra time first — minutes each half (0 = straight to penalties). */
  extraTimeMinutes?: number;
  /** BUILD 3.21: the score a football walkover goes down as — 3–0 or 5–0. */
  walkoverGoals?: number;
  /** BUILD 3.23: display only — rolling substitutions, and whether offside is played. */
  rollingSubs?: boolean;
  offside?: boolean;
  /** BUILD 3.24: a yellow card's sin bin in minutes (display only); null = none. */
  sinBinMinutes?: number | null;
  /** Stage 8 · F1/F4: football substitutions a team may make (null = no limit), in how many windows (null = any). */
  maxSubs?: number | null;
  subWindows?: number | null;
  /** Stage 8 · F10: extra time ends at the next goal ("golden goal" / "next goal wins"). */
  goldenGoal?: boolean;
  /** Stage 8 · F15: the fewest players a side may have on the pitch (null = the Laws: 7 for 11-a-side, else not checked). */
  minOnPitch?: number | null;
  /** BUILD 3.27: hockey's shoot-out takers each before sudden death (1–5). */
  shootoutTakers?: number;
  /**
   * Stage 16 · HK7 · who may take the sudden-death kicks: true = the same takers
   * as the first round (FIH: the same five), false = anyone eligible, but nobody
   * twice until every eligible team-mate has taken one (IFAB). null = the sport's
   * own (hockey true, football false). A sent-off player never takes one.
   */
  shootoutSameTakers?: boolean | null;
  /** BUILD 3.29: hockey's yellow-card suspension, 5–10 minutes (a green is always 2). */
  yellowCardMinutes?: number;
  /** BUILD 3.31: basketball's overtime length in minutes, 1–5 (display only). */
  overtimeMinutes?: number;
  /** BUILD 3.32: basketball's first-to score (7–50) — 3x3's 21, pickup's 11; null = play the periods out. */
  targetScore?: number | null;
  /** BUILD 3.33: basketball's points: '123' (5v5: FT 1, 2, 3) or '12' (3x3: 1 inside the arc, 2 beyond). */
  pointSet?: '123' | '12';
  /** BUILD 3.35: a player fouls out at 5 (FIBA) or 6 (NBA). */
  foulOut?: number;
  /** BUILD 3.42: volleyball timeouts each side may take per set, 0–3 (FIVB 2). */
  timeoutsPerSet?: number;
  /** BUILD 3.49 / 3.54: a team tie — badminton 3 or 5 rubbers, table tennis 5 (Corbillon) or 9 (Swaythling), each played to `bestOf` games; null = one match. */
  rubbers?: number | null;
  /** BUILD 3.59: tennis games to win a set, 4–10 (6 standard; a short set 4, a pro set 8). */
  gamesPerSet?: number;
  /** BUILD 3.60: tennis — a tiebreak at games-all, or none (advantage sets). */
  tiebreak?: boolean;
  /** BUILD 3.61: tennis tiebreak points, 7 or 10. */
  tiebreakTo?: number;
  /** BUILD 3.62: tennis — the final set replaced by a match tiebreak to 10. */
  matchTiebreak?: boolean;
  /** BUILD 3.63: tennis games — ad (standard), no-ad, or semi-ad. */
  adScoring?: 'ad' | 'noad' | 'semiad';
  /** BUILD 3.66: tennis — a timed match (10–180 min), scored at the buzzer; null = untimed. Stage 11 · PB9: the rally sports too (any whole number of minutes). */
  timeLimitMinutes?: number | null;
  /**
   * Stage 11 · PB9 · a timed rally match level at the buzzer (games, then the
   * points in the game in play): 'next_point' — the next point wins (as tennis);
   * 'draw' — it ends level (a league or group match, a match inside a team tie;
   * a knockout fixture always plays the next point). WPBL: 15-minute matches.
   */
  timedLevel?: 'next_point' | 'draw';
  /**
   * Stage 9 · T2: tennis — the games-all score at which a set's tiebreak is
   * played, when earlier than games-all (Fast4: first to 4, tiebreak at 3-3);
   * null = at games-all.
   */
  tiebreakAt?: number | null;
  /** Stage 9 · T2: tennis — the final set's tiebreak points when they differ (Grand Slams: 10 at 6-6); null = as every set. */
  finalSetTiebreakTo?: number | null;
  /** Stage 9 · T2: tennis — no lets on serve (Fast4): a let serve is played. Said in the rules; the pad records no lets. */
  noLet?: boolean;
  /** Stage 9 · T10: tennis — the match changes balls (ITF 7/9): the pad says when. */
  ballChange?: boolean;
  /**
   * Stage 9 · T9 · the code-violation ladder, step by step ("warning,point,game,
   * default"); null = the sport's standard (CONDUCT_LADDERS). Tennis, badminton,
   * table tennis, pickleball, volleyball.
   */
  penaltyLadder?: string | null;
  /**
   * Stage 9 · T3 · a team tie of the organiser's own matches and win rule
   * (tieCore). Tennis, badminton, table tennis, pickleball. Badminton's and
   * table tennis's standard orders stay as `rubbers` (older apps score them).
   */
  tie?: TieSpec | null;
  /** BUILD 3.72: carrom — the queen's worth, 0–5 (3 official, 5 in the home game). */
  queenPoints?: number;
  /** BUILD 3.73: carrom — the queen counts only below target − queen (true, official), or always. */
  queenCutoff?: boolean;
  /** BUILD 3.74: carrom — boards a game (1–12, ICF 8), or null for none. */
  boardCap?: number | null;
  /** BUILD 3.76: carrom — minutes a game (5–60), scored at the buzzer; null = untimed. */
  gameMinutes?: number | null;
  /** BUILD 3.77: carrom — 'board' (official: pieces left + queen) or 'points' (point carrom: white 10, black 5, queen). */
  carromMode?: 'board' | 'points';
  /** BUILD 3.77: point carrom's queen, 25 or 50. */
  queenValue?: number;
  /** BUILD 3.58: pickleball rally scoring (every rally scores) or side-out (only the server scores). */
  scoring?: 'rally' | 'sideout';
  /** Can the match end level. */
  drawAllowed?: boolean;
  /** Chess: the clock. */
  baseMinutes?: number;
  incrementSeconds?: number;
  /**
   * Stage 12 · CH6 · the rest of a chess clock, each optional: a delay (the
   * clock waits this many seconds each move before it runs — the US / Bronstein
   * "delay"); the increment only from move N (the Global Chess League's +2 s
   * from move 41); a second period (FIDE's "90 minutes for 40 moves, then 30
   * more" — minutes added to a player's clock after their Nth move).
   */
  delaySeconds?: number | null;
  incrementFromMove?: number | null;
  secondPeriodMoves?: number | null;
  secondPeriodMinutes?: number | null;
  /**
   * Stage 14 · VB2 · substitutions on the pad, any team sport: `maxSubs` counted
   * per match, per set (volleyball, FIVB 15.6: 6) or per period; who may come
   * back on — 'free' (rolling: basketball, hockey), 'same_spot' (FIVB: a starter
   * once a set, only for their own substitute; a substitute once, only for that
   * starter) or 'none'. An injury (exceptional) substitution never counts.
   */
  subsPer?: 'match' | 'set' | 'period';
  reentry?: 'free' | 'same_spot' | 'none';
  /** Stage 14 · VB7: volleyball liberos a team may name (FIVB 19: up to 2; the beach none); null = no limit. */
  liberos?: number | null;
  /**
   * Stage 14 · VB4 · change courts every N points (beach: 7) and every M in the
   * deciding set (beach: 5); null = the indoor rule (only at 8 in the deciding
   * set). A 2-a-side match without them plays the beach rule (courtSwitchOf).
   */
  sideSwitchEvery?: number | null;
  decidingSwitchEvery?: number | null;
  /**
   * Stage 14 · VB12 · the Prime Volleyball League's extras: a Super Point (once a
   * set a team calls it, before it reaches `superPointBefore` — the next rally
   * is worth 2 to whoever wins it) and a Super Serve (an ace is worth 2).
   */
  superPoint?: boolean;
  superPointBefore?: number | null;
  superServe?: boolean;
  /**
   * Stage 14 follow-up · VB11 · a casual co-ed volleyball match: at least this
   * many women in each set's line-up (typed names say woman / man). A
   * tournament's events say it on their category instead.
   */
  minWomen?: number | null;
  /**
   * Stage 15 · BB1 · basketball's time-outs as data; null = the game's standard
   * (5x5: FIBA 2 in the first half, 3 in the second — at most 2 in the last
   * 2 minutes — and 1 an overtime; 3x3: 1 a game, carried into overtime).
   */
  timeouts?: TimeoutRules | null;
  /** Stage 15 · BB3 · the team foul the penalty starts at (FIBA 5x5: the 5th; 3x3: the 7th); null = by the game. */
  teamFoulBonus?: number | null;
  /** Stage 15 · BB3 · 3x3: from this team foul, 2 free throws and the ball (the 10th); null = none. */
  teamFoulPossessionAt?: number | null;
  /** Stage 15 · BB3 · 3x3: overtime is won by the first to this many points (2); null = by the game (5x5 plays the clock). */
  overtimeTo?: number | null;
  /**
   * Stage 15 · BB2 · ejections (FIBA 2026): a player is out after this many
   * Category 1 technicals and flagrant fouls together (2) — 3x3 counts only
   * unsportsmanlike (flagrant) fouls; a head coach after this many coach "C"
   * technicals (2), or bench "B" ones (3, or 3 that include a "C").
   */
  ejectAfter?: number;
  ejectCounts?: 'tech_flagrant' | 'flagrant';
  coachEjectC?: number;
  coachEjectB?: number;
}

/** Stage 15 · BB1 · a team's time-outs (each optional; null = not counted that way). */
export type TimeoutRules = {
  firstHalf?: number | null; secondHalf?: number | null; perPeriod?: number | null; perGame?: number | null;
  perOvertime?: number | null; lateMinutes?: number | null; lateMax?: number | null; carry?: boolean;
};
/** Stage 15 · BB1 / BB3 · FIBA's time-outs: 5x5 and 3x3. */
export const FIBA_TIMEOUTS: TimeoutRules = { firstHalf: 2, secondHalf: 3, perOvertime: 1, lateMinutes: 2, lateMax: 2 };
export const FIBA_3X3_TIMEOUTS: TimeoutRules = { perGame: 1, carry: true };
/** Stage 15 · BB3 · FIBA 3x3: 3 a side, 1s and 2s, 10 minutes or 21, overtime first to 2, the bonus from the 7th foul (the 10th gives the ball), one time-out. */
export const BASKETBALL_3X3 = { players: 3, pointSet: '12' as const, targetScore: 21, periods: 1, periodMinutes: 10, overtimeTo: 2, teamFoulBonus: 7, teamFoulPossessionAt: 10, timeouts: FIBA_3X3_TIMEOUTS, ejectCounts: 'flagrant' as const };
const is3x3 = (r: Partial<MatchRules>) => r.pointSet === '12';
/** Stage 15 · the bonus team foul — the rules', else 3x3's 7th or 5x5's 5th (a 3x3 match from before showed the 5th: the bug fixed here). */
export function teamFoulBonusOf(r: Partial<MatchRules> | null | undefined): number { return r?.teamFoulBonus ?? (r && is3x3(r) ? 7 : 5); }
export function teamFoulPossessionOf(r: Partial<MatchRules> | null | undefined): number | null { return r?.teamFoulPossessionAt ?? (r && is3x3(r) ? 10 : null); }
/** Stage 15 · BB3: overtime to N points (3x3's 2), or null — the clock decides. */
export function overtimeToOf(r: Partial<MatchRules> | null | undefined): number | null { return r?.overtimeTo ?? (r && is3x3(r) ? 2 : null); }
/** Stage 15 · BB1: the time-outs a basketball match plays. */
export function timeoutRulesOf(r: Partial<MatchRules> | null | undefined): TimeoutRules { return r?.timeouts ?? (r && is3x3(r) ? FIBA_3X3_TIMEOUTS : FIBA_TIMEOUTS); }
/** Stage 15 · BB2: what ejects (3x3: flagrants only). */
export function ejectRulesOf(r: Partial<MatchRules> | null | undefined): { after: number; counts: 'tech_flagrant' | 'flagrant'; coachC: number; coachB: number } {
  return { after: r?.ejectAfter ?? 2, counts: r?.ejectCounts ?? (r && is3x3(r) ? 'flagrant' : 'tech_flagrant'), coachC: r?.coachEjectC ?? 2, coachB: r?.coachEjectB ?? 3 };
}

/**
 * Each sport's standard rules — the values the scoring engines hard-coded
 * before rules were data (SET_CONFIG, _rally configs, MATCH_LENGTHS, the
 * cricket default, periods.ts, the chess default clock).
 */
export const SPORT_RULES: Record<string, Omit<MatchRules, 'v'>> = {
  cricket: { style: 'limited', overs: 20, players: null, lastManStands: false, retireAt: null, bowlerOvers: null, extraRuns: 1, rebowl: true, freeHit: false, inningsMinutes: null, powerplayOvers: null, oneTipOneHand: false, sixAndOut: false, noLbw: false, drawAllowed: true, tie: null }, // Stage 15 follow-up: a series
  // BUILD 3.45: 15 a game capped at 21 (BAI from July 2026, BWF from 4 Jan 2027).
  // A match stored without rules still plays 21 / 30 — see rulesFromLegacy.
  badminton: { players: null, bestOf: 3, target: 15, cap: 21, finalTarget: null, winBy2: true, rubbers: null, penaltyLadder: null, tie: null, allGames: false, timeLimitMinutes: null, timedLevel: 'next_point' }, // BUILD 3.47: players 2 = doubles; 3.49 rubbers; Stage 11 · PB9 timed
  tabletennis: { bestOf: 5, target: 11, cap: null, finalTarget: null, winBy2: true, rubbers: null, penaltyLadder: null, tie: null, allGames: false, timeLimitMinutes: null, timedLevel: 'next_point' }, // BUILD 3.54 rubbers; Stage 11 · PB9 timed
  pickleball: { players: null, bestOf: 3, target: 11, cap: null, finalTarget: null, winBy2: true, scoring: 'rally', penaltyLadder: null, tie: null, allGames: false, timeLimitMinutes: null, timedLevel: 'next_point' }, // BUILD 3.58: side-out; players 2 = doubles; Stage 11 · PB9 timed
  // Stage 14 · VB2 / VB4 / VB7 / VB12: 6 subs a set back to the same spot, 2 liberos, the indoor court change, no PVL extras.
  volleyball: { players: null, bestOf: 5, target: 25, cap: null, finalTarget: 15, winBy2: true, timeoutsPerSet: 2, penaltyLadder: null, allGames: false, timeLimitMinutes: null, timedLevel: 'next_point', maxSubs: 6, subsPer: 'set', reentry: 'same_spot', liberos: 2, sideSwitchEvery: null, decidingSwitchEvery: null, superPoint: false, superPointBefore: 11, superServe: false, minWomen: null, tie: null }, // Stage 15 · BB6: a series // Stage 11 · PB9 timed
  tennis: { players: null, bestOf: 3, gamesPerSet: 6, tiebreak: true, tiebreakTo: 7, matchTiebreak: false, adScoring: 'ad', timeLimitMinutes: null, tiebreakAt: null, finalSetTiebreakTo: null, noLet: false, ballChange: false, penaltyLadder: null, tie: null }, // BUILD 3.59–3.66; Stage 9 · T2, T10, T9, T3 (players 2 = doubles)
  carrom: { bestOf: 3, target: 25, cap: null, finalTarget: null, winBy2: false, queenPoints: 3, queenCutoff: true, boardCap: null, gameMinutes: null, carromMode: 'board', queenValue: 50, tie: null, penaltyLadder: null }, // BUILD 3.72–3.77 · Stage 12 · CH5: team events
  football: { players: null, periods: 2, periodMinutes: null, halfTimeMinutes: null, penaltyKicks: 5, extraTimeMinutes: 0, walkoverGoals: 3, rollingSubs: false, offside: true, sinBinMinutes: null, drawAllowed: true, maxSubs: null, subWindows: null, goldenGoal: false, minOnPitch: null, subsPer: 'match', reentry: 'free', tie: null, shootoutSameTakers: null }, // Stage 15 · BB6: a series // Stage 14 · VB2: as before — a count a match, no re-entry check
  hockey: { players: null, periods: 4, periodMinutes: null, shootoutTakers: 5, yellowCardMinutes: 5, drawAllowed: true, maxSubs: null, subsPer: 'match', reentry: 'free', tie: null, shootoutSameTakers: null }, // Stage 14 · VB2: rolling subs (FIH) · Stage 15 · BB6: a series
  basketball: { players: null, periods: 4, periodMinutes: null, overtimeMinutes: 5, targetScore: null, pointSet: '123', foulOut: 5, drawAllowed: false, maxSubs: null, subsPer: 'match', reentry: 'free', timeouts: null, teamFoulBonus: null, teamFoulPossessionAt: null, overtimeTo: null, ejectAfter: 2, ejectCounts: 'tech_flagrant', coachEjectC: 2, coachEjectB: 3, tie: null }, // Stage 14 · VB2: unlimited (FIBA) · Stage 15: time-outs, the bonus, 3x3's overtime, ejections (null = by the game); a series (tie)
  chess: { baseMinutes: 5, incrementSeconds: 0, drawAllowed: true, tie: null, penaltyLadder: null, delaySeconds: null, incrementFromMove: null, secondPeriodMoves: null, secondPeriodMinutes: null }, // Stage 12 · CH5: team matches · CH6: the rest of the clock
};

/** The sport's standard rules, versioned. Unknown sport → just the version. */
export function standardRules(sport: string | null | undefined): MatchRules {
  return { v: 1, ...(SPORT_RULES[lengthKey(sport)] ?? {}) };
}

const CLOCK_RE = /(\d+)\s*\+\s*(\d+)/;

/**
 * The rules a match stored before rules were data plays by, from its
 * `format` / `overs` — the same readings the engines made:
 *   cricket  style from the format ("box", "pair", else limited); overs from
 *            `overs`, else 20 (inningsOvers' default — a "T7" without overs
 *            played 20)
 *   best-of  "bo<n>" when the sport offers it, else the standard length
 *   chess    the "M+S" in the format, else 5+0
 */
export function rulesFromLegacy(
  sport: string | null | undefined,
  format: string | null | undefined,
  overs: number | null | undefined,
): MatchRules {
  const key = lengthKey(sport);
  const rules = standardRules(key);
  const f = String(format ?? '').trim();
  if (key === 'cricket') {
    const lower = f.toLowerCase();
    rules.style = lower === 'box' ? 'box' : lower === 'pair' ? 'pair' : 'limited';
    // What the pad played: `overs`, else 20 (inningsOvers). A "T7" with no
    // overs played 20 — BUILD 1.9 stops new ones, and old ones read as played.
    rules.overs = overs != null && Number.isFinite(Number(overs)) && Number(overs) > 0 ? Math.floor(Number(overs)) : 20;
  } else if (MATCH_LENGTHS[key]) {
    rules.bestOf = bestOfFor(key, f) ?? rules.bestOf;
    // BUILD 3.45: badminton's standard became 15 (cap 21), but a match with no
    // rules came from an app (or an older one) that plays 21 (cap 30) — and the
    // server must count its games the same way.
    if (key === 'badminton') Object.assign(rules, BADMINTON_LEGACY);
  } else if (key === 'chess') {
    const m = CLOCK_RE.exec(f);
    if (m) {
      rules.baseMinutes = Number(m[1]);
      rules.incrementSeconds = Number(m[2]);
    }
  }
  return rules;
}

// ── BUILD 2.3 · what the scoring engines read ──────────────────────────────

/** BUILD 3.72+ · the carrom core's options from a match's rules (carromCore.CarromOpts). */
export function carromOptsOf(rules: MatchRules): { gamesToWin: number; target: number; queenPoints: number; queenCutoff: boolean; boardCap: number | null; gameMinutes: number | null } {
  return { gamesToWin: winsToWin(rules), target: rules.target ?? 25, queenPoints: rules.queenPoints ?? 3, queenCutoff: rules.queenCutoff !== false, boardCap: rules.boardCap ?? null, gameMinutes: rules.gameMinutes ?? null };
}

/** BUILD 3.72 · carrom's two games: the official 25 (queen +3 below 22) and the home 29 (queen +5 below 24). */
export const CARROM_PRESETS = [{ target: 25, queenPoints: 3, name: 'Official' }, { target: 29, queenPoints: 5, name: 'Home' }] as const;

/**
 * Stage 9 · T14 · how long a match slot is, from the format. Each sport's
 * standard (the sports table's default_duration_minutes, migration 066 — kept
 * the same here) scaled by how much play the rules ask for: sets × games a
 * set for tennis; games × points for the rally sports and carrom; overs for
 * cricket. Timed sports and chess are worked out from their clock: periods,
 * breaks, and both players' time. Null when the rules don't say (a timed sport
 * with no period length) — the sport's standard then. Rounded up to 5 minutes;
 * the organiser's own number always wins.
 */
export const SPORT_SLOT_MINUTES: Readonly<Record<string, number>> = {
  cricket: 180, football: 90, hockey: 70, tennis: 90, basketball: 60, volleyball: 75, badminton: 30, pickleball: 30, carrom: 30, tabletennis: 20, chess: 60, // volleyball: best of 5 to 25 runs ~75 min (was 45, the old sport default — device pass)
};
const up5 = (m: number) => Math.max(5, Math.ceil(m / 5) * 5);
/** Stage 11 · PB9: the rally sports a match can be timed in (tennis and carrom have their own clocks). */
export const RALLY_TIMED: ReadonlySet<string> = new Set(['badminton', 'tabletennis', 'pickleball', 'volleyball']);
/** Expected sets / games played in a best-of-n: all the winner needs, and 40% of the rest. */
const expectedUnits = (bestOf: number) => { const toWin = Math.ceil(bestOf / 2); return toWin + 0.4 * (bestOf - toWin); };
function playUnits(key: string, r: Partial<MatchRules>): number | null {
  if (key === 'tennis') {
    if (r.timeLimitMinutes) return null;
    const bestOf = r.bestOf ?? 3;
    const perSet = (r.gamesPerSet ?? 6) * (r.adScoring === 'noad' ? 0.85 : r.adScoring === 'semiad' ? 0.92 : 1);
    if (r.matchTiebreak && bestOf > 1) {
      // Full sets: all the winner needs, and 40% of the rest but the last; the match tiebreak (40%) ≈ 1.5 games.
      const toWin = Math.ceil(bestOf / 2);
      return (toWin + 0.4 * (bestOf - toWin - 1)) * perSet + 0.4 * 1.5;
    }
    return expectedUnits(bestOf) * perSet;
  }
  if (key === 'cricket') return r.overs != null ? r.overs * 2 + 3 : null; // two innings, and the change of innings
  if (key === 'badminton' || key === 'tabletennis' || key === 'pickleball' || key === 'volleyball' || key === 'carrom') {
    const target = r.target ?? null;
    if (!target) return null;
    const sideOut = key === 'pickleball' && r.scoring === 'sideout' ? 1.5 : 1;
    const games = r.rubbers ? r.rubbers * expectedUnits(r.bestOf ?? 3) : expectedUnits(r.bestOf ?? 1);
    return games * target * sideOut;
  }
  return null;
}
export function slotMinutes(sport: string | null | undefined, rules: Partial<MatchRules> | null | undefined): number | null {
  const key = lengthKey(sport);
  const std = SPORT_RULES[key] as Partial<MatchRules> | undefined;
  const base = SPORT_SLOT_MINUTES[key];
  if (!std || base == null) return null;
  const r = { ...std, ...(rules ?? {}) } as Partial<MatchRules>;
  if (key === 'tennis' && r.timeLimitMinutes) return up5(r.timeLimitMinutes + 10); // a timed match, warm-up and change-over
  // Stage 11 · PB9: a timed rally match — its minutes (each match of a tie) and a change-over.
  if (RALLY_TIMED.has(key) && r.timeLimitMinutes) return up5((r.tie?.rubbers.length ?? r.rubbers ?? 1) * (r.timeLimitMinutes + 5));
  if (key === 'football' || key === 'hockey' || key === 'basketball') {
    if (!r.periodMinutes) return null;
    const periods = r.periods ?? 2;
    const breaks = periods === 2 ? (r.halfTimeMinutes ?? 10) : periods === 4 ? (key === 'basketball' ? 2 + 15 + 2 : 2 + 10 + 2) : 0;
    const stoppages = key === 'basketball' ? 1.5 : 1; // the clock stops in basketball
    return up5(periods * r.periodMinutes * stoppages + breaks + 10);
  }
  if (key === 'chess') {
    const base2 = (r.baseMinutes ?? 5) * 2 + ((r.incrementSeconds ?? 0) * 40 * 2) / 60 + (r.secondPeriodMinutes ?? 0) * 2; // 40 moves each · CH6: the second period's minutes
    return up5(base2 + 5);
  }
  const want = playUnits(key, r); const was = playUnits(key, std);
  if (want == null || !was) return null;
  return up5((base * want) / was);
}

/**
 * Stage 9 · T9 · each sport's code-violation ladder (its governing body's): a
 * warning; a point to the opponent (table tennis: then two); tennis: then the
 * game; then a default. The organiser can set another (rules.penaltyLadder).
 *
 * Stage 11 · PB6 · the ladder is data: each sport's steps (CONDUCT_STEPS) say
 * what they're called and what they do, and a ladder is a list of a sport's
 * own step keys. Pickleball (USA Pickleball, Sec. 22): a verbal warning, a
 * technical warning, a technical foul (a point off the offender, or one to the
 * opponent when they have none), the game forfeited (recorded 11-0), the match.
 */
export const CONDUCT_LADDERS: Readonly<Record<string, string>> = {
  tennis: 'warning,point,game,default', // ITF / ATP point penalty schedule
  badminton: 'warning,point,default', // BWF: yellow, red (a fault), black (disqualified)
  tabletennis: 'warning,point,point2,default', // ITTF: yellow, yellow-red 1 point, 2 points, the referee
  pickleball: 'verbal,warning,foul,forfeit_game,default', // Stage 11 · PB6: USA Pickleball Sec. 22 (was warning, point, forfeit)
  volleyball: 'warning,point,expel,dq', // FIVB 21.3 (Stage 14 · VB3): warning, penalty, expulsion (the set), disqualification (the match) — the team plays on
  chess: 'warning,time,default', // Stage 12 · CH8 · FIDE 12.9: a warning, time to the opponent, the game lost
  carrom: 'warning,board,default', // Stage 13 · CR7 · ICF Laws 51, 91, 126, 143: a warning, the board lost, the match lost
};
/** A step's key (the sport's own: CONDUCT_STEPS). */
export type LadderStep = string;
/**
 * What a step does:
 *   'none'          nothing else changes (a warning);
 *   'points'        `n` points to the opponent;
 *   'point_off'     a point off the offender's score in the game, or (at 0) one to the opponent;
 *   'game'          the game in play to the opponent, point by point (tennis's game penalty);
 *   'forfeit_game'  the game in play to the opponent, recorded at its target to 0 (11-0);
 *   'match'         the match ends and goes to the opponent (a default / disqualification / forfeit).
 */
export type LadderEffect = 'none' | 'points' | 'point_off' | 'game' | 'forfeit_game' | 'match'
  // Stage 12 · CH8 · chess: time to the opponent's clock (2 minutes in a standard game, 1 in rapid / blitz).
  | 'time'
  // Stage 13 · CR7 · carrom: the board to the opponent, counted by the pieces and queen still on it (Law 91).
  | 'board'
  // Stage 14 · VB3 · one player out and the team plays on: for the rest of the set, or of the match.
  | 'expel_set' | 'player_out';
export type LadderStepDef = { label: string; effect: LadderEffect; n?: number };
const step = (label: string, effect: LadderEffect, n?: number): LadderStepDef => (n != null ? { label, effect, n } : { label, effect });
/** Stage 11 · PB6: every step a sport's ladder may use, in that sport's words. */
export const CONDUCT_STEPS: Readonly<Record<string, Readonly<Record<string, LadderStepDef>>>> = {
  tennis: { warning: step('warning', 'none'), point: step('point penalty', 'points', 1), game: step('game penalty', 'game'), default: step('default', 'match') },
  badminton: { warning: step('warning', 'none'), point: step('point penalty', 'points', 1), default: step('disqualification', 'match') },
  tabletennis: { warning: step('warning', 'none'), point: step('point penalty', 'points', 1), point2: step('two-point penalty', 'points', 2), default: step('disqualification', 'match') },
  pickleball: {
    verbal: step('verbal warning', 'none'), warning: step('technical warning', 'none'), foul: step('technical foul', 'point_off'),
    point: step('point penalty', 'points', 1), forfeit_game: step('game forfeit', 'forfeit_game'), default: step('match forfeit', 'match'),
  },
  // Stage 14 · VB3 · FIVB 21: a disqualified player leaves the match and the team plays on ('dq'); a team that
  // can't go on is defaulted ('default', kept for older ladders). Delays have their own track (CONDUCT_DELAY).
  volleyball: {
    warning: step('warning', 'none'), point: step('penalty', 'points', 1), expel: step('expulsion', 'expel_set'), dq: step('disqualification', 'player_out'),
    default: step('team default', 'match'), delay_warning: step('delay warning', 'none'), delay_penalty: step('delay penalty', 'points', 1),
  },
  chess: { warning: step('warning', 'none'), time: step('time to the opponent', 'time'), default: step('game lost', 'match') }, // Stage 12 · CH8
  carrom: { warning: step('warning', 'none'), board: step('board lost', 'board'), default: step('match lost', 'match') }, // Stage 13 · CR7
};
/**
 * Stage 14 · VB3 · a sport's separate ladder for delays (FIVB 16.2: the first a
 * delay warning, every later one a delay penalty — for the whole match), used
 * for the 'time' offence; other offences don't count delays, nor delays them.
 */
export const CONDUCT_DELAY: Readonly<Record<string, string>> = { volleyball: 'delay_warning,delay_penalty' };
/** The steps a delay takes in this sport, or null when delays share the misconduct ladder. */
export function delayLadder(sport: string | null | undefined): LadderStep[] | null {
  const d = CONDUCT_DELAY[lengthKey(sport)];
  return d ? d.split(',') : null;
}
/** Stage 14 · VB3: the effects that put one player out while the team plays on. */
export const PLAYER_OUT_EFFECTS: ReadonlySet<string> = new Set(['expel_set', 'player_out']);
/** A step's definition in this sport (an unknown one reads as a warning). */
export function ladderStepDef(sport: string | null | undefined, stepKey: string): LadderStepDef {
  return CONDUCT_STEPS[lengthKey(sport)]?.[stepKey] ?? step('warning', 'none');
}
/** "verbal warning, technical warning, technical foul, game forfeit, match forfeit" — a ladder in the sport's words. */
export function ladderWords(sport: string | null | undefined, ladder: string): string {
  return ladder.split(',').map((k) => ladderStepDef(sport, k.trim()).label).join(', ');
}
/** The organiser's other choices, per sport (the standard is "Standard"). */
export const LADDER_CHOICES: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  tennis: [['warning,point,default', 'Warning, point, default'], ['warning,default', 'Warning, then default']],
  badminton: [['warning,default', 'Warning, then disqualification']],
  tabletennis: [['warning,point,default', 'Warning, point, disqualification'], ['warning,default', 'Warning, then disqualification']],
  pickleball: [['warning,foul,default', 'Warning, technical foul, forfeit'], ['warning,point,default', 'Warning, point, forfeit'], ['warning,default', 'Warning, then forfeit']], // Stage 11 · PB6
  volleyball: [['warning,point,default', 'Warning, penalty, team default'], ['warning,default', 'Warning, then team default'], ['warning,expel,dq', 'Warning, expulsion, disqualification']], // Stage 14 · VB3
  chess: [['warning,default', 'Warning, then the game lost'], ['default', 'The game lost straight away']], // Stage 12 · CH8
  carrom: [['warning,default', 'Warning, then the match lost'], ['board,default', 'The board lost, then the match']], // Stage 13 · CR7
};

/**
 * What each sport calls it (the ladder's last step is 'default' in the data):
 * tennis a code violation and a default ("def."); badminton, table tennis and
 * volleyball misconduct and a disqualification ("DQ"); pickleball misconduct
 * and a forfeit. Device pass, 7 Oct: volleyball read "code violation … default".
 */
export type ConductWords = { title: string; out: string; outPast: string; short: string };
export function conductWords(sport: string | null | undefined): ConductWords {
  const key = lengthKey(sport);
  if (key === 'tennis') return { title: 'code violation', out: 'default', outPast: 'defaulted', short: 'def.' };
  if (key === 'pickleball') return { title: 'misconduct', out: 'forfeit', outPast: 'forfeited', short: 'forfeit' };
  if (key === 'chess') return { title: 'misconduct', out: 'loss', outPast: 'lost', short: 'lost' }; // Stage 12 · CH8
  if (key === 'carrom') return { title: 'misconduct', out: 'loss', outPast: 'lost the match', short: 'match lost' }; // Stage 13 · CR7
  if (key === 'volleyball') return { title: 'misconduct', out: 'default', outPast: 'defaulted', short: 'def.' }; // Stage 14 · VB3: a disqualification is one player's; the team's is a default
  return { title: 'misconduct', out: 'disqualification', outPast: 'disqualified', short: 'DQ' };
}
export function ladderProblem(key: string, ladder: unknown): string | null {
  if (typeof ladder !== 'string' || !ladder.trim() || ladder.length > 120) return 'Code violations are a list of steps.';
  const steps = ladder.split(',').map((x) => x.trim());
  const ok = CONDUCT_STEPS[key] ?? {}; // Stage 11 · PB6: the sport's own steps
  const odd = steps.find((x) => !(x in ok));
  if (odd) return `“${odd.slice(0, 20)}” isn’t a penalty here.`;
  if (steps.slice(0, -1).some((x) => ok[x]!.effect === 'match')) return `A ${conductWords(key).out} ends the match, so it can only be the last step.`;
  return null;
}
/** Stage 9 · T9: the ladder a match plays (its own, else the sport's), or [] for a sport without one. */
export function conductLadder(sport: string | null | undefined, rules: Partial<MatchRules> | null | undefined): LadderStep[] {
  const key = lengthKey(sport);
  const std = CONDUCT_LADDERS[key];
  if (!std) return [];
  const own = rules?.penaltyLadder;
  return (own && !ladderProblem(key, own) ? own : std).split(',') as LadderStep[];
}

/** BUILD 3.59+ · the tennis core's options from a match's rules (tennisCore.TennisOpts). */
export function tennisOptsOf(rules: MatchRules): { setsToWin: number; gamesPerSet: number; tiebreak: boolean; tiebreakTo: number; matchTiebreak: boolean; scoring: 'ad' | 'noad' | 'semiad'; tiebreakAt: number | null; finalSetTiebreakTo: number | null } {
  return { setsToWin: winsToWin(rules), gamesPerSet: rules.gamesPerSet ?? 6, tiebreak: rules.tiebreak !== false, tiebreakTo: rules.tiebreakTo ?? 7, matchTiebreak: rules.matchTiebreak === true, scoring: rules.adScoring ?? 'ad', tiebreakAt: rules.tiebreakAt ?? null, finalSetTiebreakTo: rules.finalSetTiebreakTo ?? null };
}

/** Games / sets / boards needed to win a best-of-n match — BUILD 3.49: rubbers, for a team tie. */
export function winsToWin(rules: MatchRules): number {
  if (rules.rubbers) return Math.floor(rules.rubbers / 2) + 1;
  return Math.floor((rules.bestOf ?? 1) / 2) + 1;
}

/** BUILD 3.49: rubbers a team tie may have. */
export const TIE_RUBBERS = [3, 5] as const;

/**
 * BUILD 3.54 · table tennis team ties, in the Cups' own order: the Corbillon
 * (4 singles and a doubles, first to 3) and the Swaythling (three a side, all
 * nine singles, first to 5). Home plays A, B, C; away X, Y, Z.
 */
export const TT_TIES: Record<number, { name: string; order: string[] }> = {
  5: { name: 'Corbillon Cup', order: ['A v X', 'B v Y', 'Doubles', 'A v Y', 'B v X'] },
  9: { name: 'Swaythling Cup', order: ['A v X', 'B v Y', 'C v Z', 'B v X', 'A v Z', 'C v Y', 'B v Z', 'C v X', 'A v Y'] },
};

/**
 * Badminton 7.16 · a badminton team tie's rubbers, in the BWF team events'
 * order (Thomas / Uber / Sudirman-style, as BAI inter-institutional ties):
 * S1 D1 S2 D2 S3 for five, S1 D1 S2 for three. S = singles, D = doubles.
 */
export const BADMINTON_TIES: Record<number, string[]> = {
  3: ['S1', 'D1', 'S2'],
  5: ['S1', 'D1', 'S2', 'D2', 'S3'],
};

/** Badminton 7.16: players in a named rubber — 1 for S…, 2 for D…. */
export function rubberPlayers(name: string): 1 | 2 {
  return name.startsWith('D') ? 2 : 1;
}

/** BUILD 3.54: who plays each rubber, when the tie has a set order. */
export function tieOrder(sport: string | null | undefined, rubbers: number | null | undefined): string[] | null {
  if (!rubbers) return null;
  if (lengthKey(sport) === 'badminton') return BADMINTON_TIES[rubbers] ?? null; // 7.16
  return lengthKey(sport) === 'tabletennis' ? TT_TIES[rubbers]?.order ?? null : null;
}

/**
 * Stage 9 · T3 · the tie a match plays: its own list (rules.tie), or a
 * badminton / table tennis standard order (rules.rubbers), first to a
 * majority; null for a single match.
 */
export function tieSpecOf(sport: string | null | undefined, rules: Partial<MatchRules> | null | undefined): TieSpec | null {
  if (!rules) return null;
  if (rules.tie && !tieSpecProblem(rules.tie)) return rules.tie;
  const order = tieOrder(sport, rules.rubbers ?? null);
  if (!order) return null;
  return { rubbers: order.map((name) => ({ key: name, label: name, players: rubberPlayers(name), ...positionsOfName(name) })), win: 'first' };
}

/**
 * Stage 10 · TT1: a standard order's "A v X" is positions — A is one player in
 * every match (the Corbillon and Swaythling had a line-up nobody could save:
 * A plays two singles). "Doubles" stays the captains' free choice.
 */
function positionsOfName(name: string): { a?: number[]; b?: number[] } {
  const m = /^([A-I]) v ([XYZ])$/.exec(name);
  if (!m) return {};
  return { a: ['ABCDEFGHI'.indexOf(m[1]!) + 1], b: ['XYZ'.indexOf(m[2]!) + 1] };
}

/**
 * Stage 10 · TT5 · games won → the match's winner, or null while it goes on: a
 * majority of `bestOf` (first to it); or, with every game played, more games
 * once all `bestOf` are played (an odd number, so never level).
 */
export function gamesWinner(a: number, b: number, bestOf: number, allGames = false): 'A' | 'B' | null {
  if (allGames) return a + b >= bestOf ? (a > b ? 'A' : b > a ? 'B' : null) : null;
  const need = Math.ceil(bestOf / 2);
  return a >= need ? 'A' : b >= need ? 'B' : null;
}

/**
 * A rally or carrom match's game rules, in the shape the server's set rollup
 * takes (and the app's rally engine, via its own field names). One source for
 * both — the numbers used to be hand-copied into each.
 */
export function setConfigOf(rules: MatchRules): { target: number; cap?: number; maxSets: number; finalTarget?: number; winBy2: boolean; allGames?: boolean } {
  return {
    ...(rules.allGames ? { allGames: true } : {}), // Stage 10 · TT5
    target: rules.target ?? 21,
    ...(rules.cap != null ? { cap: rules.cap } : {}),
    maxSets: rules.bestOf ?? 3,
    ...(rules.finalTarget != null ? { finalTarget: rules.finalTarget } : {}),
    winBy2: rules.winBy2 ?? true,
  };
}

/**
 * "Bullet", "Blitz", "Rapid", "Classical" for a clock, the FIDE way: from the
 * time for 60 moves — base minutes + increment seconds (60 × s = s minutes).
 * Blitz is 10 minutes or less, rapid more than 10 and under 60, classical 60
 * or more; bullet (under 3) is the usual online split of blitz. Decision
 * 30 Sep 2026: 10+0 is blitz, as FIDE has it (BUILD 3.67 had it rapid).
 */
export function chessClockLabel(baseMinutes: number, incrementSeconds = 0, extraMinutes = 0): string {
  // Stage 12 · CH6: a second period that comes before move 60 counts too (FIDE's 60-move estimate).
  const t = baseMinutes + incrementSeconds + extraMinutes;
  if (t < 3) return 'Bullet';
  if (t <= 10) return 'Blitz';
  if (t < 60) return 'Rapid';
  return 'Classical';
}

/**
 * Stage 12 · CH6 · a chess clock in words: "90 min + 30 s a move · +30 min after move 40",
 * "20 min + 2 s a move from move 41", "5 min · 3 s delay".
 */
export function chessClockText(r: Partial<MatchRules>): string {
  const b = r.baseMinutes ?? 5; const i = r.incrementSeconds ?? 0;
  const parts = [`${b} min${i ? ` + ${i} s a move${r.incrementFromMove && r.incrementFromMove > 1 ? ` from move ${r.incrementFromMove}` : ''}` : ''}`];
  if (r.secondPeriodMoves && r.secondPeriodMinutes) parts.push(`+${r.secondPeriodMinutes} min after move ${r.secondPeriodMoves}`);
  if (r.delaySeconds) parts.push(`${r.delaySeconds} s delay`);
  return parts.join(' · ');
}
/** Stage 12 · CH6 · the extra minutes a second period adds inside FIDE's 60 moves. */
export const chessExtraMinutes = (r: Partial<MatchRules>): number => (r.secondPeriodMoves && r.secondPeriodMoves < 60 ? r.secondPeriodMinutes ?? 0 : 0);

/** BUILD 3.67: a chess clock's limits. Stage 12 · CH6 (Dipak): no top — the organiser's clock. */
export const CHESS_BASE_MINUTES: [number, number] = [1, Number.MAX_SAFE_INTEGER];
export const CHESS_INCREMENT_SECONDS: [number, number] = [0, Number.MAX_SAFE_INTEGER];

/**
 * The `format` / `overs` to store beside the rules, for display and for older
 * apps — in the shapes they already read ("T12" / 12, "bo3", "Blitz · 5+0").
 */
export function legacyFromRules(
  sport: string | null | undefined,
  rules: MatchRules,
): { format: string | null; overs: number | null } {
  const key = lengthKey(sport);
  if (key === 'cricket') {
    const overs = rules.overs ?? 20;
    const style = rules.style ?? 'limited';
    return { format: style === 'limited' ? `T${overs}` : style, overs };
  }
  if (MATCH_LENGTHS[key] && rules.bestOf != null) return { format: `bo${rules.bestOf}`, overs: null };
  if (key === 'chess') {
    const b = rules.baseMinutes ?? 5;
    const i = rules.incrementSeconds ?? 0;
    return { format: `${chessClockLabel(b, i, chessExtraMinutes(rules))} · ${b}+${i}`, overs: null };
  }
  return { format: key || null, overs: null };
}

/**
 * A rules object read back for use: the sport's standard with the stored
 * values over it, only the sport's own fields kept, version set. Null or
 * junk → the legacy reading.
 */
export function normalizeRules(
  sport: string | null | undefined,
  rules: unknown,
  legacy: { format?: string | null; overs?: number | null } = {},
): MatchRules {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    return rulesFromLegacy(sport, legacy.format ?? null, legacy.overs ?? null);
  }
  const base = standardRules(sport);
  const given = rules as Record<string, unknown>;
  const out: Record<string, unknown> = { v: 1 };
  for (const k of Object.keys(base)) {
    if (k === 'v') continue;
    out[k] = k in given && given[k] !== undefined ? given[k] : (base as unknown as Record<string, unknown>)[k];
  }
  return out as unknown as MatchRules;
}

/** A match's rules: the stored object, or (older rows) the legacy reading. */
export function rulesOf(
  sport: string | null | undefined,
  match: { rules?: unknown; format?: string | null; overs?: number | null },
): MatchRules {
  return normalizeRules(sport, match.rules ?? null, { format: match.format ?? null, overs: match.overs ?? null });
}

// ── BUILD 2.2 · the one rules validator ─────────────────────────────────────
//
// Used by createMatch, updateMatch, tournament stage rules and the create
// form. Each field a sport has is either fixed at its standard or limited to
// the values offered today. The customisation items (Stage 3) widen these one
// field at a time — here, and nowhere else.

/** Chess clocks offered today, as [base minutes, increment seconds]. */
export const CHESS_CLOCKS: Array<[number, number]> = [[1, 0], [5, 0], [3, 2], [10, 0], [15, 10], [30, 0],
  // Stage 12 · CH6: the Indian opens' and FIDE's classical and rapid clocks.
  [10, 5], [20, 10], [25, 10], [45, 10], [60, 30], [90, 30]];
/**
 * Stage 12 · CH6 · tournament clocks beyond "M+S" (the stage chips): FIDE's
 * standard (90 minutes for 40 moves, +30, with 30 s a move from move 1 — the
 * Olympiad) and the Global Chess League's (20 minutes, +2 s from move 41).
 */
export const CHESS_CONTROLS: Array<{ value: string; label: string; rules: Partial<MatchRules> }> = [
  { value: '90/40+30+30', label: '90/40 + 30, 30 s a move (FIDE standard)', rules: { baseMinutes: 90, incrementSeconds: 30, secondPeriodMoves: 40, secondPeriodMinutes: 30 } },
  { value: '20+2@41', label: '20 + 2 s from move 41 (GCL)', rules: { baseMinutes: 20, incrementSeconds: 2, incrementFromMove: 41 } },
];

type Refusal = { error: string; code: 'BAD_RULES'; field: string | null };
const refuse = (error: string, field: string | null = null): Refusal => ({ error, code: 'BAD_RULES', field });

const FIELD_NAMES: Record<string, string> = {
  style: 'Match type', overs: 'Overs', players: 'Players a side', lastManStands: 'Last man stands', retireAt: 'Retire at', bowlerOvers: 'Max overs per bowler', extraRuns: 'Wide / no-ball runs', rebowl: 'Re-bowl wides and no-balls', freeHit: 'Free hit', inningsMinutes: 'Innings time cap', powerplayOvers: 'Powerplay overs', oneTipOneHand: 'One tip, one hand', sixAndOut: 'Six and out', noLbw: 'No LBW', bestOf: 'Match length', target: 'Points to win a game', cap: 'Point cap',
  finalTarget: 'Deciding game target', winBy2: 'Win by 2', allGames: 'Every game played', periods: 'Periods', periodMinutes: 'Period length', halfTimeMinutes: 'Half-time', penaltyKicks: 'Penalty kicks', extraTimeMinutes: 'Extra time', walkoverGoals: 'Walkover score', rollingSubs: 'Rolling subs', offside: 'Offside', sinBinMinutes: 'Sin bin', shootoutTakers: 'Shoot-out takers', yellowCardMinutes: 'Yellow card', overtimeMinutes: 'Overtime', targetScore: 'First to', pointSet: 'Points', foulOut: 'Foul-out', timeoutsPerSet: 'Timeouts a set', rubbers: 'Rubbers', scoring: 'Scoring', gamesPerSet: 'Games a set', tiebreak: 'Tiebreak', tiebreakTo: 'Tiebreak points', matchTiebreak: 'Match tiebreak', adScoring: 'Game scoring', timeLimitMinutes: 'Time limit', timedLevel: 'Level at time', tiebreakAt: 'Tiebreak at', finalSetTiebreakTo: 'Final-set tiebreak', noLet: 'Lets', ballChange: 'New balls', penaltyLadder: 'Code violations', tie: 'Team tie', queenPoints: 'Queen', queenCutoff: 'Queen cut-off', boardCap: 'Boards a game', gameMinutes: 'Minutes a game', carromMode: 'Carrom game', queenValue: 'Queen (point carrom)',
  drawAllowed: 'Draws', baseMinutes: 'Clock', incrementSeconds: 'Increment',
  // Stage 15.
  timeouts: 'Time-outs', teamFoulBonus: 'Bonus from team foul', teamFoulPossessionAt: 'Free throws and the ball from team foul', overtimeTo: 'Overtime to', ejectAfter: 'Ejection after', ejectCounts: 'Ejections count', coachEjectC: 'Coach ejection (C)', coachEjectB: 'Coach ejection (B)',
  // Stage 14.
  maxSubs: 'Substitutions', subsPer: 'Substitutions counted', reentry: 'Coming back on', liberos: 'Liberos', sideSwitchEvery: 'Change courts every', decidingSwitchEvery: 'Change courts in the deciding set every', superPoint: 'Super Point', superPointBefore: 'Super Point before', superServe: 'Super Serve', minWomen: 'Women on court',
};

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const listOf = (ns: number[]) => (ns.length === 1 ? String(ns[0]) : `${ns.slice(0, -1).join(', ')} or ${ns[ns.length - 1]}`);

/**
 * Why these rules can't be played, or null when they can. `rules` is what was
 * sent (an object); fields the sport doesn't have are refused, missing ones
 * take the standard.
 */
export function rulesRefusal(sport: string | null | undefined, rules: unknown): Refusal | null {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return refuse('Match rules must be an object.');
  const given = rules as Record<string, unknown>;
  if ('v' in given && given.v !== RULES_VERSION) return refuse('These match rules are from a newer version of the app.', 'v');
  const key = lengthKey(sport);
  const std = SPORT_RULES[key];
  if (!std) return refuse('Match rules aren’t available for this sport.');
  for (const k of Object.keys(given)) {
    if (k !== 'v' && !(k in std)) return refuse(`${FIELD_NAMES[k] ?? k} doesn’t apply to this sport.`, k);
  }
  const r = normalizeRules(key, given) as unknown as Record<string, unknown>;
  const stdMap = std as Record<string, unknown>;

  if (key === 'cricket') {
    if (r.style !== 'limited' && r.style !== 'box' && r.style !== 'pair') return refuse('Match type must be limited overs, box or pair.', 'style');
    // BUILD 3.1: any whole number of overs 1–50 (it was the format's chips).
    if (!isWhole(r.overs) || !isOfferedOvers(r.style as CricketStyle, r.overs)) {
      return refuse(`Overs must be a whole number, ${OVERS_MIN} or more.`, 'overs'); // Stage 13 · CR3: no top
    }
    // BUILD 3.2: players a side, or null (the line-up decides).
    if (r.players !== null && (!isWhole(r.players) || r.players < PLAYERS_MIN || r.players > PLAYERS_MAX)) {
      return refuse(`Players a side must be a whole number, ${PLAYERS_MIN} or more.`, 'players');
    }
    if (typeof r.lastManStands !== 'boolean') return refuse('Last man stands is on or off.', 'lastManStands');
    if (r.retireAt !== null && (!isWhole(r.retireAt) || r.retireAt < RETIRE_MIN || r.retireAt > RETIRE_MAX)) {
      return refuse(`Retire at must be off, or a whole number of runs, ${RETIRE_MIN} or more.`, 'retireAt');
    }
    // BUILD 3.5: off, or 1 to the innings' overs.
    if (r.bowlerOvers !== null && (!isWhole(r.bowlerOvers) || r.bowlerOvers < 1 || r.bowlerOvers > (r.overs as number))) {
      return refuse(`Max overs per bowler must be off, or a whole number from 1 to ${String(r.overs)}.`, 'bowlerOvers');
    }
    // …and enough of them to bowl the innings, or the pad has nobody to pick.
    if (r.bowlerOvers !== null && r.players !== null && (r.players as number) * (r.bowlerOvers as number) < (r.overs as number)) {
      return refuse(`${String(r.players)} players bowling ${String(r.bowlerOvers)} over${r.bowlerOvers === 1 ? '' : 's'} each can’t bowl ${String(r.overs)} overs. Raise the max overs per bowler.`, 'bowlerOvers');
    }
    // BUILD 3.6: a wide / no-ball is worth 0, 1 or 2.
    if (!isWhole(r.extraRuns) || r.extraRuns < EXTRA_RUNS_MIN || r.extraRuns > EXTRA_RUNS_MAX) {
      return refuse('A wide or no-ball is worth a whole number of runs, 0 or more.', 'extraRuns');
    }
    if (typeof r.rebowl !== 'boolean') return refuse('Re-bowl wides and no-balls is on or off.', 'rebowl');
    if (typeof r.freeHit !== 'boolean') return refuse('Free hit is on or off.', 'freeHit');
    if (r.inningsMinutes !== null && (!isWhole(r.inningsMinutes) || r.inningsMinutes < INNINGS_MINUTES_MIN || r.inningsMinutes > INNINGS_MINUTES_MAX)) {
      return refuse('An innings time cap must be off, or a whole number of minutes.', 'inningsMinutes');
    }
    if (r.powerplayOvers !== null && (!isWhole(r.powerplayOvers) || r.powerplayOvers < 1 || r.powerplayOvers > (r.overs as number))) {
      return refuse(`Powerplay overs must be off, or a whole number from 1 to ${String(r.overs)}.`, 'powerplayOvers');
    }
    if (typeof r.oneTipOneHand !== 'boolean') return refuse('One tip, one hand is on or off.', 'oneTipOneHand');
    if (typeof r.sixAndOut !== 'boolean') return refuse('Six and out is on or off.', 'sixAndOut');
    if (typeof r.noLbw !== 'boolean') return refuse('No LBW is on or off.', 'noLbw');
  }
  // BUILD 3.72: carrom — a game to 7–29, the queen worth 0–5.
  // Stage 13 · CR3 (Dipak): no tops — the organiser's own numbers.
  if (key === 'carrom' && (!isWhole(r.target) || r.target < 1)) return refuse('Points to win a game must be 1 or more.', 'target');
  if (key === 'carrom' && (!isWhole(r.queenPoints) || r.queenPoints < 0)) return refuse('The queen is worth a whole number of points, 0 or more.', 'queenPoints');
  if (key === 'carrom' && typeof r.queenCutoff !== 'boolean') return refuse('The queen cut-off is on or off.', 'queenCutoff'); // BUILD 3.73
  if (key === 'carrom' && r.boardCap !== null && (!isWhole(r.boardCap) || r.boardCap < 1)) return refuse('Boards a game must be off, or 1 or more.', 'boardCap'); // BUILD 3.74 · Stage 13 · CR3: no top
  if (key === 'carrom' && r.carromMode !== 'board' && r.carromMode !== 'points') return refuse('Carrom is scored by boards or by points.', 'carromMode'); // BUILD 3.77
  if (key === 'carrom' && (!isWhole(r.queenValue) || r.queenValue < 0)) return refuse('In point carrom the queen is a whole number of points, 0 or more.', 'queenValue'); // Stage 13 · CR3: any value (25 and 50 are the usual)
  if (key === 'carrom' && r.gameMinutes !== null && (!isWhole(r.gameMinutes) || r.gameMinutes < 1)) return refuse('A game’s time must be off, or a whole number of minutes.', 'gameMinutes'); // BUILD 3.76 · Stage 13 · CR3: no top
  // BUILD 3.59: tennis games a set, short set (4) to pro set (10).
  if (key === 'tennis' && (!isWhole(r.gamesPerSet) || r.gamesPerSet < 1)) { // Stage 13 · CR3: no top
    return refuse('Games a set must be 1 or more.', 'gamesPerSet');
  }
  if (key === 'tennis' && typeof r.tiebreak !== 'boolean') return refuse('A tiebreak is on or off.', 'tiebreak'); // BUILD 3.60
  if (key === 'tennis' && (!isWhole(r.tiebreakTo) || r.tiebreakTo < 1)) return refuse('A tiebreak is to a whole number of points (7 and 10 are the usual).', 'tiebreakTo'); // BUILD 3.61 · Stage 13 · CR3
  if (key === 'tennis' && typeof r.matchTiebreak !== 'boolean') return refuse('A match tiebreak is on or off.', 'matchTiebreak'); // BUILD 3.62
  if (key === 'tennis' && r.timeLimitMinutes !== null && (!isWhole(r.timeLimitMinutes) || r.timeLimitMinutes < 1)) {
    return refuse('A time limit must be off, or a whole number of minutes.', 'timeLimitMinutes'); // BUILD 3.66 · Stage 13 · CR3: no top
  }
  if (key === 'tennis' && r.players !== null && r.players !== DOUBLES_PLAYERS) return refuse('Tennis players a side is 2 (doubles), or not set for singles.', 'players'); // BUILD 3.65
  if (key === 'tennis' && r.adScoring !== 'ad' && r.adScoring !== 'noad' && r.adScoring !== 'semiad') return refuse('Games are ad, no-ad or semi-ad.', 'adScoring'); // BUILD 3.63
  if (key === 'tennis' && r.matchTiebreak === true && r.bestOf === 1) return refuse('A match tiebreak replaces a final set — there is none in a one-set match.', 'matchTiebreak');
  // Stage 9 · T2: Fast4's early tiebreak, the Grand Slams' final-set tiebreak, no lets.
  if (key === 'tennis' && r.tiebreakAt !== null && (!isWhole(r.tiebreakAt) || r.tiebreakAt < 1 || r.tiebreakAt > (r.gamesPerSet as number))) {
    return refuse(`A tiebreak comes at 1-all to ${String(r.gamesPerSet)}-all.`, 'tiebreakAt');
  }
  if (key === 'tennis' && r.tiebreakAt !== null && r.tiebreak === false) return refuse('Set when the tiebreak comes only with tiebreaks on.', 'tiebreakAt');
  if (key === 'tennis' && r.finalSetTiebreakTo !== null && (!isWhole(r.finalSetTiebreakTo) || r.finalSetTiebreakTo < 1)) return refuse('A final-set tiebreak is to a whole number of points (7 and 10 are the usual).', 'finalSetTiebreakTo'); // Stage 13 · CR3
  if (key === 'tennis' && r.finalSetTiebreakTo !== null && (r.matchTiebreak === true || r.tiebreak === false)) {
    return refuse(r.matchTiebreak === true ? 'With a match tiebreak there’s no final set to give its own tiebreak.' : 'A final-set tiebreak needs tiebreaks on.', 'finalSetTiebreakTo');
  }
  if (key === 'tennis' && typeof r.noLet !== 'boolean') return refuse('Lets are on or off.', 'noLet');
  if (key === 'tennis' && typeof r.ballChange !== 'boolean') return refuse('New balls are on or off.', 'ballChange'); // Stage 9 · T10
  // Stage 11 · PB9: a timed rally match — any whole number of minutes (the organiser's), and what a level score at time does.
  if (RALLY_TIMED.has(key) && r.timeLimitMinutes !== null && (!isWhole(r.timeLimitMinutes) || r.timeLimitMinutes < 1)) return refuse('A time limit must be off, or a whole number of minutes.', 'timeLimitMinutes');
  if (RALLY_TIMED.has(key) && r.timedLevel !== 'next_point' && r.timedLevel !== 'draw') return refuse('Level at time: the next point wins, or it stays level.', 'timedLevel');
  // BUILD 3.58: pickleball scores every rally, or side-out (doubles: players 2).
  if (key === 'pickleball' && r.scoring !== 'rally' && r.scoring !== 'sideout') return refuse('Scoring is rally or side-out.', 'scoring');
  if (key === 'pickleball' && r.players !== null && r.players !== DOUBLES_PLAYERS) {
    return refuse('Pickleball players a side is 2 (doubles), or not set for singles.', 'players');
  }
  // BUILD 3.56: pickleball plays win by 2, or a golden point (winBy2 false).
  if ((key === 'pickleball' || key === 'tabletennis') && typeof r.winBy2 !== 'boolean') return refuse('Win by 2 is on or off (golden point).', 'winBy2'); // Stage 10 · TT5: table tennis too
  // Stage 10 · TT5: every game played — on or off; it needs an odd number of games (no level matches).
  if (r.allGames !== undefined && typeof r.allGames !== 'boolean') return refuse('Playing every game is on or off.', 'allGames');
  if (r.allGames === true && Number(r.bestOf ?? 1) % 2 === 0) return refuse('Every game played needs an odd number of games.', 'allGames');
  // BUILD 3.49: a team tie is 3 or 5 rubbers.
  if (key === 'badminton' && r.rubbers !== null && !(TIE_RUBBERS as readonly unknown[]).includes(r.rubbers)) {
    return refuse('A team tie is 3 or 5 rubbers.', 'rubbers');
  }
  if (key === 'tabletennis' && r.rubbers !== null && !TT_TIES[r.rubbers as number]) {
    return refuse('A table tennis team tie is the Corbillon (5 rubbers) or the Swaythling (9).', 'rubbers');
  }
  if (key === 'badminton' && r.rubbers != null && r.players != null) {
    return refuse('A team tie mixes singles and doubles rubbers — leave players a side unset.', 'players');
  }
  // BUILD 3.47: badminton doubles is 2 a side; singles leaves it unset.
  if (key === 'badminton' && r.players !== null && r.players !== DOUBLES_PLAYERS) {
    return refuse('Badminton players a side is 2 (doubles), or not set for singles.', 'players');
  }
  // BUILD 3.16 / 3.26: players a side — football 3–11, hockey 4–11 (null = not set).
  const side = SIDE_LIMITS[key];
  if (side && r.players !== null && (!isWhole(r.players) || r.players < side[0])) { // Stage 13 · CR3: no top
    return refuse(`Players a side must be a whole number, ${side[0]} or more.`, 'players');
  }
  // BUILD 3.17: a timed sport's periods, their length and (football) half-time.
  const timed = TIMED_LIMITS[key];
  if (timed) {
    if (!isWhole(r.periods) || r.periods < timed.periods[0]) { // Stage 13 · CR3: no top
      return refuse(`Periods must be a whole number, ${timed.periods[0]} or more.`, 'periods');
    }
    if (r.periodMinutes !== null && (!isWhole(r.periodMinutes) || r.periodMinutes < timed.minutes[0])) {
      return refuse('A period must be off, or a whole number of minutes.', 'periodMinutes');
    }
    if ('halfTimeMinutes' in stdMap && r.halfTimeMinutes !== null && (!isWhole(r.halfTimeMinutes) || r.halfTimeMinutes < 0)) {
      return refuse('Half-time must be off, or a whole number of minutes.', 'halfTimeMinutes');
    }
  }
  // BUILD 3.18: 3 or 5 penalties each, then sudden death.
  if (key === 'football' && (!isWhole(r.penaltyKicks) || r.penaltyKicks < 1)) { // Stage 13 · CR3: any number (3 and 5 are the usual)
    return refuse('Penalty kicks must be a whole number, 1 or more each.', 'penaltyKicks');
  }
  // BUILD 3.23: two on/off flags, shown on the match (no effect on scoring).
  if (key === 'football' && typeof r.rollingSubs !== 'boolean') return refuse('Rolling subs is on or off.', 'rollingSubs');
  if (key === 'football' && typeof r.offside !== 'boolean') return refuse('Offside is on or off.', 'offside');
  // BUILD 3.35: foul out at 5 or 6.
  if (key === 'basketball' && (!isWhole(r.foulOut) || r.foulOut < 1)) return refuse('A player fouls out at a whole number of fouls (5 and 6 are the usual).', 'foulOut'); // Stage 13 · CR3
  // BUILD 3.33: 1-2-3 (5v5) or 1-2 (3x3).
  if (key === 'basketball' && r.pointSet !== '123' && r.pointSet !== '12') return refuse('Points are 1-2-3 or 1-2.', 'pointSet');
  // Stage 15 · BB1 / BB2 / BB3: time-outs, the bonus, overtime to N, ejections — the organiser's numbers, no top.
  if (key === 'basketball') {
    const whole0 = (x: unknown) => x == null || (isWhole(x) && x >= 0);
    const t = r.timeouts as TimeoutRules | null;
    if (t != null) {
      if (typeof t !== 'object' || Array.isArray(t)) return refuse('Time-outs are a set of numbers.', 'timeouts');
      const unknownKey = Object.keys(t).find((k) => !['firstHalf', 'secondHalf', 'perPeriod', 'perGame', 'perOvertime', 'lateMinutes', 'lateMax', 'carry'].includes(k));
      if (unknownKey) return refuse(`“${unknownKey}” isn’t a time-out rule.`, 'timeouts');
      if (!['firstHalf', 'secondHalf', 'perPeriod', 'perGame', 'perOvertime', 'lateMinutes', 'lateMax'].every((k) => whole0((t as Record<string, unknown>)[k]))) return refuse('Time-outs are whole numbers, 0 or more.', 'timeouts');
      if (t.carry != null && typeof t.carry !== 'boolean') return refuse('Carrying time-outs over is on or off.', 'timeouts');
    }
    if (r.teamFoulBonus != null && (!isWhole(r.teamFoulBonus) || r.teamFoulBonus < 1)) return refuse('The bonus starts at a team foul, 1 or more.', 'teamFoulBonus');
    if (r.teamFoulPossessionAt != null && (!isWhole(r.teamFoulPossessionAt) || r.teamFoulPossessionAt < 1)) return refuse('Free throws and the ball start at a team foul, 1 or more.', 'teamFoulPossessionAt');
    if (r.overtimeTo != null && (!isWhole(r.overtimeTo) || r.overtimeTo < 1)) return refuse('Overtime is first to 1 point or more.', 'overtimeTo');
    if (!isWhole(r.ejectAfter) || (r.ejectAfter as number) < 1) return refuse('A player is out after 1 or more technicals or flagrants.', 'ejectAfter');
    if (r.ejectCounts !== 'tech_flagrant' && r.ejectCounts !== 'flagrant') return refuse('Ejections count technicals and flagrants, or flagrants only.', 'ejectCounts');
    if (!isWhole(r.coachEjectC) || (r.coachEjectC as number) < 1 || !isWhole(r.coachEjectB) || (r.coachEjectB as number) < 1) return refuse('A coach is out after 1 or more technicals.', 'coachEjectC');
  }
  // BUILD 3.32: first to 7–50, or off.
  if (key === 'basketball' && r.targetScore !== null && (!isWhole(r.targetScore) || r.targetScore < 1)) { // Stage 13 · CR3: no top
    return refuse('First to must be off, or a whole number of points.', 'targetScore');
  }
  // BUILD 3.31: basketball overtime, 1–5 minutes.
  if (key === 'basketball' && (!isWhole(r.overtimeMinutes) || r.overtimeMinutes < 1)) { // Stage 13 · CR3: no top
    return refuse('Overtime must be 1 minute or more.', 'overtimeMinutes');
  }
  // BUILD 3.29: a hockey yellow card suspends for 5–10 minutes.
  if (key === 'hockey' && (!isWhole(r.yellowCardMinutes) || r.yellowCardMinutes < 1)) { // Stage 13 · CR3: no top
    return refuse('A yellow card suspends for a whole number of minutes.', 'yellowCardMinutes');
  }
  // Stage 16 · HK7: who takes the sudden-death kicks — on, off, or the sport's own (blank).
  if ((key === 'hockey' || key === 'football') && r.shootoutSameTakers != null && typeof r.shootoutSameTakers !== 'boolean') return refuse('Who takes the sudden-death kicks is on, off, or the sport’s own.', 'shootoutSameTakers');
  // BUILD 3.27: hockey's shoot-out takers, 1–5.
  if (key === 'hockey' && (!isWhole(r.shootoutTakers) || r.shootoutTakers < 1)) { // Stage 13 · CR3: no top
    return refuse('Shoot-out takers must be 1 or more each.', 'shootoutTakers');
  }
  // BUILD 3.24: a sin bin of 2–15 minutes, or none.
  if (key === 'football' && r.sinBinMinutes !== null && (!isWhole(r.sinBinMinutes) || r.sinBinMinutes < 1)) { // Stage 13 · CR3: no top
    return refuse('A sin bin must be off, or a whole number of minutes.', 'sinBinMinutes');
  }
  // Stage 8 · F1/F4: an organiser's substitutions limit and windows (optional; no app top), golden goal (F10), the fewest on the pitch (F15).
  if (key === 'football' && r.maxSubs != null && (!isWhole(r.maxSubs) || r.maxSubs < 0)) return refuse('Substitutions must be a whole number, or no limit.', 'maxSubs');
  if (key === 'football' && r.subWindows != null && (!isWhole(r.subWindows) || r.subWindows < 1)) return refuse('Substitution windows must be 1 or more, or any.', 'subWindows');
  if (key === 'football' && r.goldenGoal != null && typeof r.goldenGoal !== 'boolean') return refuse('Golden goal is on or off.', 'goldenGoal');
  if (key === 'football' && r.minOnPitch != null && (!isWhole(r.minOnPitch) || r.minOnPitch < 1 || (isWhole(r.players) && r.minOnPitch > r.players))) {
    return refuse('The fewest players on the pitch must be from 1 to the players a side.', 'minOnPitch');
  }
  // BUILD 3.21: a walkover goes down as 3–0 or 5–0.
  if (key === 'football' && (!isWhole(r.walkoverGoals) || r.walkoverGoals < 1)) return refuse('A walkover is a whole number of goals to 0 (3–0 and 5–0 are the usual).', 'walkoverGoals'); // Stage 13 · CR3
  // BUILD 3.20: whether a league / group match may end level.
  if ((key === 'football' || key === 'hockey') && typeof r.drawAllowed !== 'boolean') return refuse('Draws are allowed or not.', 'drawAllowed');
  // BUILD 3.19: extra time, 0 (none) to 15 minutes a half.
  if (key === 'football' && (!isWhole(r.extraTimeMinutes) || r.extraTimeMinutes < 0)) { // Stage 13 · CR3: no top
    return refuse('Extra time must be off, or a whole number of minutes a half.', 'extraTimeMinutes');
  }
  // BUILD 3.42: volleyball timeouts a set, 0–3.
  if (key === 'volleyball' && (!isWhole(r.timeoutsPerSet) || r.timeoutsPerSet < 0)) { // Stage 13 · CR3: no top
    return refuse('Timeouts a set must be a whole number, 0 or more.', 'timeoutsPerSet');
  }
  // Stage 14 · VB2: the organiser's substitutions (optional; no app top), counted a match / set / period, and who comes back.
  if (SUB_PAD_SPORTS.has(key) && key !== 'football' && r.maxSubs != null && (!isWhole(r.maxSubs) || r.maxSubs < 0)) return refuse('Substitutions must be a whole number, or no limit.', 'maxSubs');
  if (SUB_PAD_SPORTS.has(key) && r.subsPer != null && !['match', 'set', 'period'].includes(r.subsPer as string)) return refuse('Substitutions are counted a match, a set or a period.', 'subsPer');
  if (SUB_PAD_SPORTS.has(key) && r.subsPer === 'set' && key !== 'volleyball') return refuse('Only volleyball is played in sets.', 'subsPer');
  if (SUB_PAD_SPORTS.has(key) && r.subsPer === 'period' && key === 'volleyball') return refuse('Volleyball counts substitutions a set or a match.', 'subsPer');
  if (SUB_PAD_SPORTS.has(key) && r.reentry != null && !['free', 'same_spot', 'none'].includes(r.reentry as string)) return refuse('Coming back on is free, to the same spot, or not at all.', 'reentry');
  // Stage 14 · VB7 / VB4 / VB12 · volleyball: liberos, court changes, the PVL extras.
  if (key === 'volleyball') {
    if (r.liberos != null && (!isWhole(r.liberos) || r.liberos < 0)) return refuse('Liberos must be a whole number, or no limit.', 'liberos');
    if (r.sideSwitchEvery != null && (!isWhole(r.sideSwitchEvery) || r.sideSwitchEvery < 1)) return refuse('Change courts every 1 point or more, or off.', 'sideSwitchEvery');
    if (r.decidingSwitchEvery != null && (!isWhole(r.decidingSwitchEvery) || r.decidingSwitchEvery < 1)) return refuse('Change courts in the deciding set every 1 point or more, or off.', 'decidingSwitchEvery');
    if (typeof r.superPoint !== 'boolean') return refuse('Super Point is on or off.', 'superPoint');
    if (typeof r.superServe !== 'boolean') return refuse('Super Serve is on or off.', 'superServe');
    if (r.superPointBefore != null && (!isWhole(r.superPointBefore) || r.superPointBefore < 1)) return refuse('A Super Point is called before a team reaches 1 point or more, or any time.', 'superPointBefore');
    if (r.minWomen != null && (!isWhole(r.minWomen) || r.minWomen < 1)) return refuse('Women on court is a whole number, 1 or more, or off.', 'minWomen');
  }
  // BUILD 3.37: a rally sport's points to win a set.
  const rally = RALLY_LIMITS[key];
  if (rally && (!isWhole(r.target) || r.target < 1)) { // Stage 13 · CR3: no top
    return refuse(`Points to win a ${rally.unit ?? 'set'} must be 1 or more.`, 'target');
  }
  // BUILD 3.39: a cap — off, or the target to target + span, and never below
  // the deciding set's target (it couldn't be reached).
  if (rally?.capSpan != null && r.cap !== null) {
    // Stage 13 · CR3: no top — at least the target (and the deciding set's, which it must reach).
    const lo = Math.max(r.target as number, typeof r.finalTarget === 'number' ? r.finalTarget : 0);
    if (!isWhole(r.cap) || r.cap < lo) {
      return refuse(`The cap must be off, or ${lo} or more.`, 'cap');
    }
  }
  // BUILD 3.38: the deciding set's points (null = the same as the others).
  if (rally?.finalTarget && r.finalTarget !== null && (!isWhole(r.finalTarget) || r.finalTarget < 1)) { // Stage 13 · CR3: no top
    return refuse('The deciding set must be 1 point or more.', 'finalTarget');
  }
  if (MATCH_LENGTHS[key]) {
    // Stage 13 · CR3: best of any odd number (the chips are the usual ones); an even count can't always find a winner.
    void listOf;
    if (!isWhole(r.bestOf) || r.bestOf < 1 || r.bestOf % 2 === 0) return refuse('Match length must be best of an odd number (1, 3, 5, 7…).', 'bestOf');
  }
  if (key === 'chess') {
    // BUILD 3.67: any clock (the chips are presets). Stage 12 · CH6 (Dipak): no top — 1 minute or more, any increment.
    if (!isWhole(r.baseMinutes) || r.baseMinutes < CHESS_BASE_MINUTES[0]) return refuse('The clock must be 1 minute or more.', 'baseMinutes');
    if (!isWhole(r.incrementSeconds) || r.incrementSeconds < 0) return refuse('The increment is a whole number of seconds a move.', 'incrementSeconds');
    if (r.delaySeconds != null && (!isWhole(r.delaySeconds) || r.delaySeconds < 0)) return refuse('A delay is a whole number of seconds.', 'delaySeconds');
    if (r.incrementFromMove != null && (!isWhole(r.incrementFromMove) || r.incrementFromMove < 1)) return refuse('The increment starts at move 1 or later.', 'incrementFromMove');
    if ((r.secondPeriodMoves == null) !== (r.secondPeriodMinutes == null)) return refuse('A second period needs both its move and its minutes.', 'secondPeriodMoves');
    if (r.secondPeriodMoves != null && (!isWhole(r.secondPeriodMoves) || r.secondPeriodMoves < 1)) return refuse('A second period starts after move 1 or later.', 'secondPeriodMoves');
    if (r.secondPeriodMinutes != null && (!isWhole(r.secondPeriodMinutes) || r.secondPeriodMinutes < 1)) return refuse('A second period adds 1 minute or more.', 'secondPeriodMinutes');
  }
  // Stage 9 · T3: a team tie of the organiser's own matches.
  // Stage 15 · BB6: a team sport's tie is a best-of-N series and nothing else.
  if ((SERIES_SPORTS as readonly string[]).includes(key) && r.tie != null) {
    const bad = tieSpecProblem(r.tie);
    if (bad) return refuse(bad, 'tie');
    if ((r.tie as TieSpec).series !== true) return refuse('A team game’s knockout tie is a series of games.', 'tie');
  }
  if ((TIE_SPORTS as readonly string[]).includes(key) && r.tie !== null && r.tie !== undefined) {
    const bad = tieSpecProblem(r.tie);
    if (bad) return refuse(bad, 'tie');
    if (r.rubbers) return refuse('A tie is its own list of matches, or a standard order — not both.', 'tie');
    // Stage 11 follow-up: the trump picks are the teams' (with their orders), never the rules'.
    if ((r.tie as TieSpec).trumps != null) return refuse('Trump matches are picked by the teams with their orders.', 'tie');
    // Stage 12 · CH5: chess boards are one player each; colours and board points are chess's own.
    const tt = r.tie as TieSpec;
    if (key === 'chess' && tt.rubbers.some((x) => x.players !== 1)) return refuse('A chess board is one player a side.', 'tie');
    if (key !== 'chess' && (tt.colours != null || tt.boardPoints != null)) return refuse('Colours by board and board points are for team chess.', 'tie');
    // Stage 11 · PB3: a match's own rules (the DreamBreaker) are the sport's rules over the tie's.
    for (const rb of (r.tie as TieSpec).rubbers) {
      if (!rb.rules) continue;
      const merged: Record<string, unknown> = { ...given, ...rb.rules, tie: null, rubbers: null, players: rb.players === 2 ? DOUBLES_PLAYERS : null };
      for (const k of ['rubbers', 'players']) if (!(k in std)) delete merged[k]; // only the fields this sport has
      const own = rulesRefusal(key, merged);
      if (own) return refuse(`${rb.label}: ${own.error}`, 'tie');
    }
  }
  // Stage 9 · T9: a code-violation ladder — known steps, a default only last.
  if (CONDUCT_LADDERS[key] && r.penaltyLadder !== null) {
    const bad = ladderProblem(key, r.penaltyLadder);
    if (bad) return refuse(bad, 'penaltyLadder');
  }
  // Everything else is fixed at the sport's standard for now.
  const open = new Set(['style', 'overs', 'players', 'lastManStands', 'retireAt', 'bowlerOvers', 'extraRuns', 'rebowl', 'freeHit', 'inningsMinutes', 'powerplayOvers', 'oneTipOneHand', 'sixAndOut', 'noLbw', 'bestOf', 'baseMinutes', 'incrementSeconds', 'delaySeconds', 'incrementFromMove', 'secondPeriodMoves', 'secondPeriodMinutes',
    ...(timed ? ['periods', 'periodMinutes', 'halfTimeMinutes'] : []), ...(key === 'volleyball' ? ['timeoutsPerSet', 'liberos', 'sideSwitchEvery', 'decidingSwitchEvery', 'superPoint', 'superPointBefore', 'superServe', 'minWomen'] : []), ...(SUB_PAD_SPORTS.has(key) ? ['maxSubs', 'subsPer', 'reentry'] : []), ...(key === 'badminton' || key === 'tabletennis' ? ['rubbers'] : []), ...(key === 'pickleball' ? ['winBy2', 'scoring'] : []), ...(RALLY_TIMED.has(key) ? ['timeLimitMinutes', 'timedLevel'] : []), ...(key === 'tabletennis' ? ['winBy2'] : []), ...(key === 'badminton' || key === 'tabletennis' || key === 'pickleball' || key === 'volleyball' ? ['allGames'] : []), ...(key === 'carrom' ? ['target', 'queenPoints', 'queenCutoff', 'boardCap', 'gameMinutes', 'carromMode', 'queenValue'] : []), ...(key === 'tennis' ? ['gamesPerSet', 'tiebreak', 'tiebreakTo', 'matchTiebreak', 'adScoring', 'timeLimitMinutes', 'tiebreakAt', 'finalSetTiebreakTo', 'noLet', 'ballChange'] : []), ...(CONDUCT_LADDERS[key] ? ['penaltyLadder'] : []), ...((TIE_SPORTS as readonly string[]).includes(key) || (SERIES_SPORTS as readonly string[]).includes(key) ? ['tie'] : []), ...(rally ? ['target', ...(rally.finalTarget ? ['finalTarget'] : []), ...(rally.capSpan != null ? ['cap'] : [])] : []), ...(key === 'hockey' ? ['shootoutTakers', 'yellowCardMinutes', 'shootoutSameTakers', 'drawAllowed'] : []), ...(key === 'basketball' ? ['overtimeMinutes', 'targetScore', 'pointSet', 'foulOut', 'timeouts', 'teamFoulBonus', 'teamFoulPossessionAt', 'overtimeTo', 'ejectAfter', 'ejectCounts', 'coachEjectC', 'coachEjectB'] : []), ...(key === 'football' ? ['shootoutSameTakers', 'penaltyKicks', 'extraTimeMinutes', 'drawAllowed', 'walkoverGoals', 'rollingSubs', 'offside', 'sinBinMinutes', 'maxSubs', 'subWindows', 'goldenGoal', 'minOnPitch'] : [])]);
  for (const k of Object.keys(stdMap)) {
    if (open.has(k)) continue;
    if (r[k] !== stdMap[k]) return refuse(`${FIELD_NAMES[k] ?? k} can’t be changed for this sport yet.`, k);
  }
  return null;
}

/**
 * BUILD 3.37+ · the rally rules a sport may set (others stay standard):
 * `target` points to win a set / game; `finalTarget` the deciding set's (3.38);
 * `capSpan` how far above the target a cap may sit (3.39; off = no cap).
 */
export const RALLY_LIMITS: Record<string, { target: [number, number]; finalTarget?: [number, number]; capSpan?: number; unit?: 'set' | 'game' }> = {
  volleyball: { target: [10, 30], finalTarget: [10, 25], capSpan: 10 },
  badminton: { target: [5, 30], capSpan: 15, unit: 'game' }, // BUILD 3.44
  tabletennis: { target: [5, 21], unit: 'game' }, // BUILD 3.50: 11 (ITTF) or the old 21
  pickleball: { target: [5, 25], unit: 'game' }, // BUILD 3.55: 11, 15 or 21
};

/**
 * BUILD 3.44 · badminton's two ways to play: 15 a game capped at 21 (BAI from
 * July 2026, BWF from 4 Jan 2027) and the classic 21 capped at 30.
 */
export const BADMINTON_PRESETS = [{ target: 15, cap: 21 }, { target: 21, cap: 30 }] as const;
/** BUILD 3.50 · table tennis: 11 a game (ITTF), or the old 21 still played in offices. */
export const TABLE_TENNIS_PRESETS = [11, 21] as const;
/** BUILD 3.55 · pickleball: 11 (the base game), 15 (IPBL), 21. */
export const PICKLEBALL_PRESETS = [11, 15, 21] as const;
/** BUILD 3.45: what a badminton match with no stored rules plays (the pre-2026 game). */
export const BADMINTON_LEGACY = { target: 21, cap: 30 } as const;
/** The cap a badminton game gets when the form leaves it blank: the preset's, else none. */
export function badmintonCapFor(target: number): number | null {
  return BADMINTON_PRESETS.find((p) => p.target === target)?.cap ?? null;
}

/** BUILD 3.17: the periods and period lengths a timed sport may set (others stay standard). */
export const TIMED_LIMITS: Record<string, { periods: [number, number]; minutes: [number, number] }> = {
  // Stage 13 · CR3 (Dipak): the minimums only — no top on periods or minutes.
  football: { periods: [1, Number.MAX_SAFE_INTEGER], minutes: [1, Number.MAX_SAFE_INTEGER] },
  hockey: { periods: [1, Number.MAX_SAFE_INTEGER], minutes: [1, Number.MAX_SAFE_INTEGER] }, // BUILD 3.25
  basketball: { periods: [1, Number.MAX_SAFE_INTEGER], minutes: [1, Number.MAX_SAFE_INTEGER] }, // BUILD 3.30 (length shown only — no clock)
};
export const HALF_TIME_MAX = Number.MAX_SAFE_INTEGER; // Stage 13 · CR3: no top
/** BUILD 3.19: extra time's longest half. */
export const EXTRA_TIME_MAX = Number.MAX_SAFE_INTEGER; // Stage 13 · CR3: no top

/** BUILD 3.16: a football side, 3 (futsal-ish) to 11. */
export const FOOTBALL_PLAYERS_MIN = 1; // Stage 13 · CR3: 1 a side or more
export const FOOTBALL_PLAYERS_MAX = Number.MAX_SAFE_INTEGER; // Stage 13 · CR3: no top
/** BUILD 3.26: a hockey side, 4 (small-sided turf) to 11. */
export const HOCKEY_PLAYERS_MIN = 1; // Stage 13 · CR3: 1 a side or more
export const HOCKEY_PLAYERS_MAX = Number.MAX_SAFE_INTEGER; // Stage 13 · CR3: no top
/** BUILD 3.34: a basketball side, 1 (one-on-one) to 5. */
export const BASKETBALL_PLAYERS_MIN = 1; // Stage 13 · CR3: 1 a side or more
export const BASKETBALL_PLAYERS_MAX = Number.MAX_SAFE_INTEGER; // Stage 13 · CR3: no top
/** BUILD 3.29: a hockey green card's suspension (FIH: 2 minutes). */
export const HOCKEY_GREEN_MINUTES = 2;

/**
 * BUILD 3.24 / 3.29 · the suspension each card kind carries in this match, for
 * the pad's timers: football's yellow → its sin bin (if set); hockey's green →
 * 2 min and yellow → its 5–10. A red is off for good (no timer).
 */
export function cardSuspensions(sport: string | null | undefined, rules: MatchRules): Partial<Record<string, number>> {
  const key = lengthKey(sport);
  if (key === 'football') return rules.sinBinMinutes ? { yellow: rules.sinBinMinutes } : {};
  if (key === 'hockey') return { green: HOCKEY_GREEN_MINUTES, yellow: rules.yellowCardMinutes ?? 5 };
  return {};
}

/**
 * Stage 8 · F15 · the fewest players a football side may have on the pitch:
 * the organiser's number, else the Laws' 7 for 11-a-side (Law 3); null when
 * neither applies (small-sided with no number set — not checked).
 */
export function minOnPitchFor(rules: Partial<MatchRules> | null | undefined): number | null {
  if (!rules) return null;
  if (rules.minOnPitch != null) return rules.minOnPitch;
  return rules.players === 11 ? 7 : null;
}

/**
 * Stage 8 · F2 · football by the size of the game: one tap sets players a side,
 * halves, half-time, subs, offside and extra time. Every value stays editable.
 * Small-sided (5–8): rolling subs, no offside, no extra time. 9-a-side (AIFF
 * U-15): offside. 11-a-side: the Laws — 2 × 45, 5 subs in 3 windows, 7 minimum.
 */
export const FOOTBALL_PRESETS = [
  { value: '5', label: '5 a side', rules: { players: 5, periods: 2, periodMinutes: 20, halfTimeMinutes: 5, rollingSubs: true, offside: false, extraTimeMinutes: 0, maxSubs: null, subWindows: null } },
  { value: '6', label: '6 a side', rules: { players: 6, periods: 2, periodMinutes: 20, halfTimeMinutes: 5, rollingSubs: true, offside: false, extraTimeMinutes: 0, maxSubs: null, subWindows: null } },
  { value: '7', label: '7 a side', rules: { players: 7, periods: 2, periodMinutes: 25, halfTimeMinutes: 5, rollingSubs: true, offside: false, extraTimeMinutes: 0, maxSubs: null, subWindows: null } },
  { value: '8', label: '8 a side', rules: { players: 8, periods: 2, periodMinutes: 25, halfTimeMinutes: 5, rollingSubs: true, offside: false, extraTimeMinutes: 0, maxSubs: null, subWindows: null } },
  { value: '9', label: '9 a side', rules: { players: 9, periods: 2, periodMinutes: 30, halfTimeMinutes: 10, rollingSubs: false, offside: true, extraTimeMinutes: 10, maxSubs: null, subWindows: null } },
  { value: '11', label: '11 a side', rules: { players: 11, periods: 2, periodMinutes: 45, halfTimeMinutes: 15, rollingSubs: false, offside: true, extraTimeMinutes: 15, maxSubs: 5, subWindows: 3 } },
] as const;

/**
 * Stage 9 · T2 · tennis in one tap. Each fills the tennis rules; every value
 * stays editable.
 * - Best of 3 / best of 5: tiebreak sets (best of 5: the Grand Slams' 10-point
 *   tiebreak at 6-6 in the final set).
 * - 2 sets + match tiebreak: a 10-point tiebreak instead of the third set.
 * - Junior doubles: the same, no-ad (ITF juniors, ATP doubles).
 * - Pro set to 8 / 9: one set; Pune ranking rounds play 9.
 * - Short sets: first to 4, tiebreak at 4-4.
 * - Fast4 (LTA): first to 4, tiebreak at 3-3, no-ad, match tiebreak at one
 *   set all, no lets.
 */
export const TENNIS_PRESETS = [
  { value: 'bo3', label: 'Best of 3', rules: { bestOf: 3, gamesPerSet: 6, tiebreak: true, tiebreakTo: 7, tiebreakAt: null, matchTiebreak: false, finalSetTiebreakTo: null, adScoring: 'ad', noLet: false } },
  { value: 'bo5', label: 'Best of 5', rules: { bestOf: 5, gamesPerSet: 6, tiebreak: true, tiebreakTo: 7, tiebreakAt: null, matchTiebreak: false, finalSetTiebreakTo: 10, adScoring: 'ad', noLet: false } },
  { value: 'mtb', label: '2 sets + match tiebreak', rules: { bestOf: 3, gamesPerSet: 6, tiebreak: true, tiebreakTo: 7, tiebreakAt: null, matchTiebreak: true, finalSetTiebreakTo: null, adScoring: 'ad', noLet: false } },
  { value: 'jdoubles', label: 'Junior doubles', rules: { bestOf: 3, gamesPerSet: 6, tiebreak: true, tiebreakTo: 7, tiebreakAt: null, matchTiebreak: true, finalSetTiebreakTo: null, adScoring: 'noad', noLet: false } },
  { value: 'pro8', label: 'Pro set to 8', rules: { bestOf: 1, gamesPerSet: 8, tiebreak: true, tiebreakTo: 7, tiebreakAt: null, matchTiebreak: false, finalSetTiebreakTo: null, adScoring: 'ad', noLet: false } },
  { value: 'pro9', label: 'Pro set to 9', rules: { bestOf: 1, gamesPerSet: 9, tiebreak: true, tiebreakTo: 7, tiebreakAt: null, matchTiebreak: false, finalSetTiebreakTo: null, adScoring: 'ad', noLet: false } },
  { value: 'short4', label: 'Short sets to 4', rules: { bestOf: 3, gamesPerSet: 4, tiebreak: true, tiebreakTo: 7, tiebreakAt: null, matchTiebreak: false, finalSetTiebreakTo: null, adScoring: 'ad', noLet: false } },
  { value: 'fast4', label: 'Fast4', rules: { bestOf: 3, gamesPerSet: 4, tiebreak: true, tiebreakTo: 7, tiebreakAt: 3, matchTiebreak: true, finalSetTiebreakTo: null, adScoring: 'noad', noLet: true } },
] as const;

/** Stage 9 · T2: the tennis preset these rules match, or null. */
export function tennisPresetOf(rules: Partial<MatchRules> | null | undefined): string | null {
  if (!rules) return null;
  const r = rules as Record<string, unknown>;
  const std = SPORT_RULES.tennis as unknown as Record<string, unknown>;
  return TENNIS_PRESETS.find((p) => Object.entries(p.rules).every(([k, v]) => (r[k] ?? std[k] ?? null) === v))?.value ?? null;
}

/** The preset a football rules object matches, if any (by players a side and its other values). */
export function footballPresetOf(r: Partial<MatchRules> | null | undefined): string | null {
  if (!r) return null;
  const hit = FOOTBALL_PRESETS.find((p) => Object.entries(p.rules).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
  return hit?.value ?? null;
}

/** BUILD 3.41: beach volleyball — 2 a side, sets to 21, a deciding set to 15, best of 3. */
export const BEACH_VOLLEYBALL = { players: 2, target: 21, finalTarget: 15, bestOf: 3, timeoutsPerSet: 1, sideSwitchEvery: 7, decidingSwitchEvery: 5, maxSubs: 0, liberos: 0 } as const; // BUILD 3.42: one timeout a set on the beach · Stage 14 · VB4: courts every 7 (5 in set 3), no subs, no libero

/**
 * Stage 14 · VB4 · when a volleyball match changes courts: every N points (and
 * every M in the deciding set), or — null — the indoor rule (at 8 in the
 * deciding set only). A 2-a-side match that doesn't say plays the beach rule
 * (FIVB Beach 18.2: every 7, every 5 in set 3): the beach preset used to keep
 * the indoor change at 8 (the bug fixed here).
 */
export function courtSwitchOf(rules: Partial<MatchRules> | null | undefined): { every: number; deciding: number } | null {
  if (!rules) return null;
  if (rules.sideSwitchEvery != null) return { every: rules.sideSwitchEvery, deciding: rules.decidingSwitchEvery ?? rules.sideSwitchEvery };
  if (rules.players === 2) return { every: 7, deciding: rules.decidingSwitchEvery ?? 5 };
  return null;
}

/**
 * Stage 14 · VB8 · how a point was won, per sport (asked with "who?", never
 * required). Each is a leaderboard of its own; an opponent's error credits nobody.
 */
export type PointHow = { key: string; label: string; board?: string; error?: boolean };
export const POINT_HOW: Readonly<Record<string, ReadonlyArray<PointHow>>> = {
  volleyball: [{ key: 'attack', label: 'Attack', board: 'Attack points' }, { key: 'block', label: 'Block', board: 'Block points' }, { key: 'ace', label: 'Ace', board: 'Aces' }, { key: 'error', label: 'Opponent error', error: true }],
  badminton: [{ key: 'smash', label: 'Smash', board: 'Smash winners' }, { key: 'winner', label: 'Other winner', board: 'Winners' }, { key: 'error', label: 'Opponent error', error: true }],
  tabletennis: [{ key: 'serve', label: 'Serve', board: 'Serve points' }, { key: 'winner', label: 'Winner', board: 'Winners' }, { key: 'error', label: 'Opponent error', error: true }],
  pickleball: [{ key: 'ace', label: 'Ace', board: 'Aces' }, { key: 'winner', label: 'Winner', board: 'Winners' }, { key: 'error', label: 'Opponent error', error: true }],
};
export function pointHowFor(sport: string | null | undefined): ReadonlyArray<PointHow> {
  return POINT_HOW[lengthKey(sport)] ?? [];
}

/**
 * Stage 16 · HK2 · how a goal was scored, on the "who scored?" sheet
 * (optional): hockey's field goal / penalty corner / penalty stroke (Hockey5s
 * has no penalty corners); football's open play / free kick / penalty. A
 * penalty (stroke) from its own button carries its "how" already.
 */
export const GOAL_HOW: Readonly<Record<string, ReadonlyArray<PointHow>>> = {
  hockey: [{ key: 'field', label: 'Field goal' }, { key: 'pc', label: 'Penalty corner', board: 'Penalty-corner goals' }, { key: 'stroke', label: 'Penalty stroke', board: 'Penalty-stroke goals' }],
  football: [{ key: 'open', label: 'Open play' }, { key: 'free_kick', label: 'Free kick', board: 'Free-kick goals' }, { key: 'penalty', label: 'Penalty', board: 'Penalty goals' }],
};
export function goalHowFor(sport: string | null | undefined, players?: number | null): ReadonlyArray<PointHow> {
  const k = lengthKey(sport);
  const all = GOAL_HOW[k] ?? [];
  return k === 'hockey' && players === 5 ? all.filter((h) => h.key !== 'pc') : all;
}

/**
 * Stage 14 · VB8 · basketball's own player stats beyond points, assists and
 * fouls (FIBA box score): each is a pad button that asks who, and a leaderboard.
 */
export const BASKETBALL_STATS: ReadonlyArray<{ key: string; label: string; board: string }> = [
  // Stage 15 · BB8: the box score — offensive and defensive rebounds, steals, blocks, turnovers.
  { key: 'oreb', label: 'OREB', board: 'Offensive rebounds' }, { key: 'dreb', label: 'DREB', board: 'Defensive rebounds' },
  { key: 'steal', label: 'STL', board: 'Steals' }, { key: 'block', label: 'BLK', board: 'Blocks' }, { key: 'turnover', label: 'TO', board: 'Turnovers' },
];
/** Stage 15 · BB8: every stat a basketball note may carry — the pad's, Stage 14's plain rebound, and a missed shot. */
export const BASKETBALL_STAT_KEYS: ReadonlySet<string> = new Set([...BASKETBALL_STATS.map((s) => s.key), 'rebound', 'miss']);

/** Stage 14 · VB2: the sports whose pad has a SUB button and keeps their own substitution rules. */
export const SUB_PAD_SPORTS: ReadonlySet<string> = new Set(['football', 'hockey', 'basketball', 'volleyball']);

/** BUILD 3.47: doubles is exactly two a side. */
export const DOUBLES_PLAYERS = 2;
/**
 * BUILD 3.47 · why a doubles line-up can't stand, or null. `phase` 'lineup':
 * no side may have more than 2; 'start': no side may have just 1 (0 is a
 * typed-in team, which has no players to list). Rules without players = 2
 * (singles, other sports) are never refused here.
 */
export function doublesLineupProblem(
  sport: string | null | undefined,
  rules: MatchRules,
  counts: { A: number; B: number },
  names: { A: string; B: string },
  phase: 'lineup' | 'start',
): string | null {
  if (lengthKey(sport) !== 'badminton' || rules.players !== DOUBLES_PLAYERS) return null;
  for (const side of ['A', 'B'] as const) {
    const n = counts[side];
    if (n > DOUBLES_PLAYERS) return `Doubles is two a side — ${names[side]} has ${n}.`;
    if (phase === 'start' && n === 1) return `Doubles is two a side — ${names[side]} needs a partner in the line-up.`;
  }
  return null;
}

/** Stage 14 · VB2: a match's substitutions in words when they aren't the sport's standard ("4 subs a set", "no subs"). */
function subsWords(rules: Partial<MatchRules>, std: Partial<MatchRules>): string | null {
  if (rules.maxSubs === std.maxSubs && rules.subsPer === std.subsPer && rules.reentry === std.reentry) return null;
  if (rules.maxSubs === 0) return 'no subs';
  const n = rules.maxSubs == null ? 'unlimited subs' : `${rules.maxSubs} sub${rules.maxSubs === 1 ? '' : 's'}${rules.subsPer === 'set' ? ' a set' : rules.subsPer === 'period' ? ' a period' : ''}`;
  const back = rules.reentry !== std.reentry ? (rules.reentry === 'same_spot' ? ', back to the same spot' : rules.reentry === 'none' ? ', no coming back on' : ', rolling') : '';
  return `${n}${back}`;
}

/** BUILD 3.28: FIH Hockey5s — 5 a side, two halves of 10 minutes. */
export const HOCKEY5S = { players: 5, periods: 2, periodMinutes: 10 } as const;
/** Stage 16 · HK8 · FIH indoor hockey in one tap: 6 a side (5 and a goalkeeper), 4 quarters of 10 minutes, on a sideboarded court. */
export const HOCKEY_INDOOR = { players: 6, periods: 4, periodMinutes: 10 } as const;
const SIDE_LIMITS: Record<string, [number, number]> = {
  // Stage 13 · CR3 (Dipak): 1 a side or more — no top.
  football: [1, Number.MAX_SAFE_INTEGER],
  hockey: [1, Number.MAX_SAFE_INTEGER],
  basketball: [1, Number.MAX_SAFE_INTEGER], // BUILD 3.34
  volleyball: [1, Number.MAX_SAFE_INTEGER], // BUILD 3.40: beach 2, indoor 6, 9-a-side are the usual
};

/**
 * BUILD 3.16+ · the rules of a timed team sport in words, for the pad and
 * Match Detail headers ("7-a-side"). Parts the match doesn't set are left out.
 */
export function timedRulesLabel(sport: string | null | undefined, rules: MatchRules): string | null {
  const key = lengthKey(sport);
  const parts: string[] = [];
  // Stage 9 · T3: the organiser's own tie, any tie sport.
  if (rules.tie && !tieSpecProblem(rules.tie) && rules.tie.series) parts.push(`best of ${rules.tie.rubbers.length} games`); // Stage 15 · BB6
  else if (rules.tie && !tieSpecProblem(rules.tie)) {
    const n = rules.tie.rubbers.length;
    parts.push(`team tie · ${n} ${n === 1 ? 'match' : 'matches'} · ${rules.tie.win === 'first' ? `first to ${tieNeedOf(rules.tie)}` : rules.tie.win === 'all' ? (tieWeighted(rules.tie) ? 'most matches by worth' : 'most matches') /* Stage 11 follow-up: a match worth more, or a trump */ : `most ${key === 'tennis' ? 'games' : 'points'}`}`);
    // Stage 11 · PB3: a deciding match when level; a match worth more.
    const dec = rules.tie.rubbers.filter((x) => x.decider);
    if (dec.length) parts.push(`level: ${dec.map((x) => x.label).join(', ')} decides`);
    for (const x of rules.tie.rubbers) if ((x.value ?? 1) > 1) parts.push(`${x.label} worth ${x.value}`);
    if (rules.tie.trump) parts.push(`a trump match each (counts double${rules.tie.trumpLoss ? '; lost: −1' : ''})`); // Stage 11 follow-up; 2.14: PBL's −1
  }
  // BUILD 3.37+: a rally sport's own points, said when they differ from the standard.
  if (RALLY_LIMITS[key]) {
    const std = SPORT_RULES[key] ?? {};
    if (rules.rubbers) parts.push(key === 'tabletennis' && TT_TIES[rules.rubbers] ? `${TT_TIES[rules.rubbers]!.name} · ${rules.rubbers} rubbers` : `team tie · ${rules.rubbers} rubbers`); // BUILD 3.49 / 3.54
    if (rules.players) parts.push(key === 'badminton' || key === 'pickleball' ? 'doubles' : `${rules.players}-a-side`); // BUILD 3.40 / 3.47 / 3.58
    if (rules.target != null && rules.target !== std.target) parts.push(`${RALLY_LIMITS[key]!.unit ?? 'set'}s to ${rules.target}`); // BUILD 3.44: badminton plays games
    if (rules.cap !== undefined && rules.cap !== std.cap) parts.push(rules.cap == null ? 'no cap' : `cap ${rules.cap}`); // BUILD 3.39
    if (key === 'pickleball' && rules.scoring === 'sideout') parts.push('side-out scoring'); // BUILD 3.58
    if ((key === 'pickleball' || key === 'tabletennis') && rules.winBy2 === false) parts.push(key === 'tabletennis' ? `golden point at ${(rules.target ?? 11) - 1}-all` : 'golden point'); // BUILD 3.56 · Stage 10 · TT5
    if (rules.allGames) parts.push(`all ${rules.bestOf ?? 3} ${(RALLY_LIMITS[key]!.unit ?? 'set') === 'set' ? 'sets' : 'games'} played`); // Stage 10 · TT5
    if (rules.timeLimitMinutes) parts.push(`timed · ${rules.timeLimitMinutes} min${rules.timedLevel === 'draw' ? ' · level stays level' : ''}`); // Stage 11 · PB9
    if (rules.timeoutsPerSet != null && rules.timeoutsPerSet !== std.timeoutsPerSet) parts.push(rules.timeoutsPerSet === 0 ? 'no timeouts' : `${rules.timeoutsPerSet} timeout${rules.timeoutsPerSet === 1 ? '' : 's'} a set`); // BUILD 3.42
    if (rules.finalTarget !== undefined && rules.finalTarget !== std.finalTarget && (rules.bestOf ?? 3) > 1) parts.push(rules.finalTarget == null ? 'decider the same' : `decider to ${rules.finalTarget}`); // BUILD 3.38 (Stage 11 follow-up: a one-set match has no decider to mention)
    // Stage 14 · VB2 / VB4 / VB7 / VB12: volleyball's own, when not the standard.
    if (key === 'volleyball') {
      const sw = courtSwitchOf(rules);
      if (sw) parts.push(`courts every ${sw.every}${sw.deciding !== sw.every ? ` (${sw.deciding} in the decider)` : ''}`);
      const subs = subsWords(rules, std);
      if (subs) parts.push(subs);
      if (rules.liberos !== undefined && rules.liberos !== std.liberos) parts.push(rules.liberos === 0 ? 'no libero' : rules.liberos == null ? 'any liberos' : `${rules.liberos} libero${rules.liberos === 1 ? '' : 's'}`);
      if (rules.superPoint) parts.push(`Super Point${rules.superPointBefore != null ? ` before ${rules.superPointBefore}` : ''}`);
      if (rules.superServe) parts.push('Super Serve (an ace is 2)');
      if (rules.minWomen) parts.push(`at least ${rules.minWomen} ${rules.minWomen === 1 ? 'woman' : 'women'} on court`);
    }
    return parts.length ? parts.join(' · ') : null;
  }
  // BUILD 3.72+: carrom — said when it isn't the official game.
  if (key === 'carrom' && rules.carromMode === 'points') return `point carrom · queen ${rules.queenValue ?? 50}`; // BUILD 3.77
  if (key === 'carrom') {
    if (rules.target != null && rules.target !== 25) parts.push(`games to ${rules.target}`);
    if (rules.queenPoints != null && rules.queenPoints !== 3) parts.push(rules.queenPoints === 0 ? 'no queen points' : `queen +${rules.queenPoints}`);
    if (rules.queenCutoff === false && rules.queenPoints !== 0) parts.push('queen always counts'); // BUILD 3.73
    if (rules.boardCap) parts.push(`${rules.boardCap} boards a game`); // BUILD 3.74
    if (rules.gameMinutes) parts.push(`${rules.gameMinutes} min a game`); // BUILD 3.76
    return parts.length ? parts.join(' · ') : null;
  }
  // BUILD 3.59+: tennis — said when it isn't sets to 6.
  if (key === 'tennis') {
    if (rules.players === DOUBLES_PLAYERS) parts.push('doubles'); // BUILD 3.65
    if (rules.gamesPerSet != null && rules.gamesPerSet !== 6) parts.push(rules.bestOf === 1 && (rules.gamesPerSet === 8 || rules.gamesPerSet === 9) ? `pro set to ${rules.gamesPerSet}` : `sets to ${rules.gamesPerSet}`); // Stage 9 · T2: 9 too
    if (rules.tiebreak === false) parts.push('advantage sets'); // BUILD 3.60
    else if (rules.tiebreakTo === 10) parts.push('10-point tiebreaks'); // BUILD 3.61
    if (rules.matchTiebreak) parts.push('match tiebreak for the final set'); // BUILD 3.62
    if (rules.timeLimitMinutes) parts.push(`timed · ${rules.timeLimitMinutes} min`); // BUILD 3.66
    if (rules.adScoring === 'noad' || rules.adScoring === 'semiad') parts.push(rules.adScoring === 'noad' ? 'no-ad' : 'semi-ad'); // BUILD 3.63
    // Stage 9 · T2.
    if (rules.tiebreakAt != null && rules.tiebreakAt !== (rules.gamesPerSet ?? 6) && rules.tiebreak !== false) parts.push(`tiebreak at ${rules.tiebreakAt}-${rules.tiebreakAt}`);
    if (rules.finalSetTiebreakTo != null) parts.push(`final-set tiebreak to ${rules.finalSetTiebreakTo}`);
    if (rules.noLet === true) parts.push('no lets');
    if (rules.ballChange === true) parts.push('new balls 7/9'); // Stage 9 · T10
    return parts.length ? parts.join(' · ') : null;
  }
  if (key !== 'football' && key !== 'hockey' && key !== 'basketball') return null;
  if (rules.players) parts.push(`${rules.players}-a-side`);
  // BUILD 3.17: "2 × 25 min", and the half-time when it's set.
  if (rules.periodMinutes) parts.push(`${rules.periods ?? 1} × ${rules.periodMinutes} min`);
  if (rules.halfTimeMinutes != null) parts.push(`HT ${rules.halfTimeMinutes} min`);
  // BUILD 3.18: 3 penalties each is the turf-cup way; 5 is the standard, left unsaid.
  if (rules.extraTimeMinutes) parts.push(`ET 2 × ${rules.extraTimeMinutes} min`); // BUILD 3.19
  if (key === 'football' && rules.drawAllowed === false) parts.push('no draws'); // BUILD 3.20
  if (key === 'football' && rules.walkoverGoals === 5) parts.push('walkover 5–0'); // BUILD 3.21 (3–0 left unsaid)
  // BUILD 3.23: said only when they differ from the Laws.
  if (key === 'football' && rules.rollingSubs === true) parts.push('rolling subs');
  if (key === 'football' && rules.offside === false) parts.push('no offside');
  if (key === 'football' && rules.sinBinMinutes) parts.push(`sin bin ${rules.sinBinMinutes} min`); // BUILD 3.24
  if (key === 'hockey' && rules.shootoutTakers != null && rules.shootoutTakers !== 5) parts.push(`shoot-out ${rules.shootoutTakers} each`); // BUILD 3.27
  if (key === 'hockey' && rules.yellowCardMinutes != null && rules.yellowCardMinutes !== 5) parts.push(`yellow ${rules.yellowCardMinutes} min`); // BUILD 3.29
  if (key === 'basketball' && rules.overtimeMinutes != null && rules.overtimeMinutes !== 5) parts.push(`OT ${rules.overtimeMinutes} min`); // BUILD 3.31
  if (key === 'basketball' && rules.targetScore) parts.push(`first to ${rules.targetScore}`); // BUILD 3.32
  if (key === 'basketball' || key === 'hockey') { const subs = subsWords(rules, SPORT_RULES[key] as Partial<MatchRules>); if (subs) parts.push(subs); } // Stage 14 · VB2
  if (key === 'basketball' && rules.pointSet === '12') parts.push('1s and 2s'); // BUILD 3.33
  if (key === 'basketball' && rules.foulOut != null && rules.foulOut !== 5) parts.push(`foul out at ${rules.foulOut}`); // BUILD 3.35 (5 left unsaid)
  // Stage 15 · BB1 / BB2 / BB3: time-outs, the bonus, 3x3's overtime and ejections — said when not the standard.
  if (key === 'basketball') {
    const to = rules.timeouts;
    const std = rules.pointSet === '12' ? FIBA_3X3_TIMEOUTS : FIBA_TIMEOUTS;
    if (to && JSON.stringify({ ...std, ...to }) !== JSON.stringify(std)) {
      const w = (n: number | null | undefined) => `${Number(n ?? 0)} ${Number(n ?? 0) === 1 ? 'time-out' : 'time-outs'}`;
      parts.push(to.perGame != null ? `${w(to.perGame)} a game` : to.perPeriod != null ? `${w(to.perPeriod)} a period` : `time-outs ${to.firstHalf ?? 2} + ${to.secondHalf ?? 3}${to.lateMax != null ? ` (at most ${to.lateMax} in the last ${to.lateMinutes ?? 2} min)` : ''}, ${to.perOvertime ?? 1} each overtime`);
    }
    if (rules.overtimeTo != null && !(rules.pointSet === '12' && rules.overtimeTo === 2)) parts.push(`overtime first to ${rules.overtimeTo}`);
    if (rules.teamFoulBonus != null && rules.teamFoulBonus !== (rules.pointSet === '12' ? 7 : 5)) parts.push(`bonus from team foul ${rules.teamFoulBonus}`);
    if (rules.ejectAfter != null && rules.ejectAfter !== 2) parts.push(`out after ${rules.ejectAfter} technicals or flagrants`);
  }
  if (rules.penaltyKicks === 3) parts.push('3 pens each');
  return parts.length ? parts.join(' · ') : null;
}

/**
 * BUILD 3.21 · the winner's goals when a match is a walkover (the loser's are
 * 0): football per its rules (3 or 5); other sports keep a walkover scoreless
 * (their own walkover score is BUILD 4.8).
 */
export function walkoverGoalsOf(sport: string | null | undefined, rules: MatchRules): number | null {
  return lengthKey(sport) === 'football' ? (rules.walkoverGoals === 5 ? 5 : 3) : null;
}

// ── BUILD 2.4 · a tournament's rules per stage ──────────────────────────────
//
// tournaments.match_rules = { default?, group?, knockout?, final? }, each a
// rules object (or part of one). A fixture takes its stage's rules: the final
// falls back to knockout then default; knockout and group to default; a stage
// the organiser left alone is the sport's standard. Copied onto every fixture
// at the draw.

// Badminton gap 4: 'qf' = from the quarter-finals (the quarter- and semi-finals),
// so early rounds can be one game and the later ones best of 3.
export type Stage = 'group' | 'knockout' | 'qf' | 'final';
export const STAGE_KEYS = ['default', 'group', 'knockout', 'qf', 'final'] as const;
export type TournamentRules = Partial<Record<(typeof STAGE_KEYS)[number], Partial<MatchRules>>>;

/** The rules a fixture in `stage` plays by. */
export function stageRules(sport: string | null | undefined, rules: unknown, stage: Stage): MatchRules {
  const t = (rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {}) as Record<string, unknown>;
  const chain = stage === 'final' ? ['final', 'qf', 'knockout', 'default']
    : stage === 'qf' ? ['qf', 'knockout', 'default']
      : stage === 'knockout' ? ['knockout', 'default'] : ['group', 'default'];
  const hit = chain.map((k) => t[k]).find((r) => r && typeof r === 'object' && !Array.isArray(r));
  // BUILD 3.45: no rules for the stage → what an app without rules plays (the
  // legacy reading), not the standard: badminton's standard is 15 now, and an
  // older app scoring the fixture plays 21.
  return hit ? normalizeRules(sport, hit) : rulesFromLegacy(sport, null, null);
}

/** Why a tournament's stage rules can't be used, or null. Each stage is checked by rulesRefusal. */
export function tournamentRulesRefusal(sport: string | null | undefined, rules: unknown): Refusal | null {
  if (rules === null || rules === undefined) return null;
  if (typeof rules !== 'object' || Array.isArray(rules)) return refuse('Tournament match rules must be an object.');
  const labels: Record<string, string> = { default: 'Every match', group: 'Group / league matches', knockout: 'Knockout matches', qf: 'From the quarter-finals', final: 'The final' };
  for (const [k, v] of Object.entries(rules as Record<string, unknown>)) {
    if (!(STAGE_KEYS as readonly string[]).includes(k)) return refuse(`${k} isn’t a tournament stage (default, group, knockout, qf or final).`, k);
    const bad = rulesRefusal(sport, v);
    if (bad) return { ...bad, error: `${labels[k]}: ${bad.error}` };
  }
  return null;
}

/** Stage 16 · HK7: the sudden-death takers rule for a match (the rules', else the sport's own). */
export function shootoutSameTakersOf(sport: string | null | undefined, rules: Partial<MatchRules> | null | undefined): boolean {
  return rules?.shootoutSameTakers ?? (lengthKey(sport) === 'hockey');
}

/**
 * Stage 16 · HK7 · who can't take the next kick for a side: a sent-off player
 * never; in the first round, nobody twice; in sudden death, the same takers
 * (FIH) or nobody twice until all eligible have taken one (IFAB).
 * `eligible` = the side's players (line-up and typed-in), by id.
 */
export function shootoutBlocked(
  events: ReadonlyArray<{ event_type: string; payload?: unknown }>, side: 'A' | 'B', eligible: readonly string[], perSide: number, same: boolean,
): string[] {
  const red = new Set<string>();
  const kicks: string[] = [];
  let sideKicks = 0;
  for (const e of events) {
    const p = (e.payload ?? {}) as { team_side?: unknown; kind?: unknown; player_id?: unknown };
    if ((p.team_side === 'B' ? 'B' : 'A') !== side) continue;
    if (e.event_type === 'card' && p.kind === 'red' && typeof p.player_id === 'string') red.add(p.player_id);
    if (e.event_type === 'note' && p.kind === 'shootout_kick') { sideKicks += 1; if (typeof p.player_id === 'string') kicks.push(p.player_id); }
  }
  const ok = eligible.filter((id) => !red.has(id));
  let allowed: Set<string>;
  if (sideKicks < perSide) allowed = new Set(ok.filter((id) => !kicks.includes(id)));
  else if (same) { const first = new Set(kicks.slice(0, perSide)); allowed = new Set(ok.filter((id) => first.size === 0 || first.has(id))); }
  else {
    const count = (id: string) => kicks.filter((k) => k === id).length;
    const min = Math.min(...ok.map(count));
    allowed = new Set(ok.filter((id) => count(id) === min));
  }
  return eligible.filter((id) => !allowed.has(id));
}
