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
import { MATCH_LENGTHS, bestOfFor, lengthKey } from './matchLength';
import { OVERS_MIN, OVERS_MAX, PLAYERS_MIN, PLAYERS_MAX, RETIRE_MIN, RETIRE_MAX, EXTRA_RUNS_MIN, EXTRA_RUNS_MAX, INNINGS_MINUTES_MIN, INNINGS_MINUTES_MAX, isOfferedOvers } from './cricketRules';

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
  /** BUILD 3.66: tennis — a timed match (10–180 min), scored at the buzzer; null = untimed. */
  timeLimitMinutes?: number | null;
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
}

/**
 * Each sport's standard rules — the values the scoring engines hard-coded
 * before rules were data (SET_CONFIG, _rally configs, MATCH_LENGTHS, the
 * cricket default, periods.ts, the chess default clock).
 */
export const SPORT_RULES: Record<string, Omit<MatchRules, 'v'>> = {
  cricket: { style: 'limited', overs: 20, players: null, lastManStands: false, retireAt: null, bowlerOvers: null, extraRuns: 1, rebowl: true, freeHit: false, inningsMinutes: null, powerplayOvers: null, oneTipOneHand: false, sixAndOut: false, noLbw: false, drawAllowed: true },
  // BUILD 3.45: 15 a game capped at 21 (BAI from July 2026, BWF from 4 Jan 2027).
  // A match stored without rules still plays 21 / 30 — see rulesFromLegacy.
  badminton: { players: null, bestOf: 3, target: 15, cap: 21, finalTarget: null, winBy2: true, rubbers: null }, // BUILD 3.47: players 2 = doubles; 3.49 rubbers
  tabletennis: { bestOf: 5, target: 11, cap: null, finalTarget: null, winBy2: true, rubbers: null }, // BUILD 3.54 rubbers
  pickleball: { players: null, bestOf: 3, target: 11, cap: null, finalTarget: null, winBy2: true, scoring: 'rally' }, // BUILD 3.58: side-out; players 2 = doubles
  volleyball: { players: null, bestOf: 5, target: 25, cap: null, finalTarget: 15, winBy2: true, timeoutsPerSet: 2 },
  tennis: { players: null, bestOf: 3, gamesPerSet: 6, tiebreak: true, tiebreakTo: 7, matchTiebreak: false, adScoring: 'ad', timeLimitMinutes: null, tiebreakAt: null, finalSetTiebreakTo: null, noLet: false, ballChange: false }, // BUILD 3.59–3.66; Stage 9 · T2, T10 (players 2 = doubles)
  carrom: { bestOf: 3, target: 25, cap: null, finalTarget: null, winBy2: false, queenPoints: 3, queenCutoff: true, boardCap: null, gameMinutes: null, carromMode: 'board', queenValue: 50 }, // BUILD 3.72–3.77
  football: { players: null, periods: 2, periodMinutes: null, halfTimeMinutes: null, penaltyKicks: 5, extraTimeMinutes: 0, walkoverGoals: 3, rollingSubs: false, offside: true, sinBinMinutes: null, drawAllowed: true, maxSubs: null, subWindows: null, goldenGoal: false, minOnPitch: null },
  hockey: { players: null, periods: 4, periodMinutes: null, shootoutTakers: 5, yellowCardMinutes: 5, drawAllowed: true },
  basketball: { players: null, periods: 4, periodMinutes: null, overtimeMinutes: 5, targetScore: null, pointSet: '123', foulOut: 5, drawAllowed: false },
  chess: { baseMinutes: 5, incrementSeconds: 0, drawAllowed: true },
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
  cricket: 180, football: 90, hockey: 70, tennis: 90, basketball: 60, volleyball: 45, badminton: 30, pickleball: 30, carrom: 30, tabletennis: 20, chess: 60,
};
const up5 = (m: number) => Math.max(5, Math.ceil(m / 5) * 5);
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
  if (key === 'football' || key === 'hockey' || key === 'basketball') {
    if (!r.periodMinutes) return null;
    const periods = r.periods ?? 2;
    const breaks = periods === 2 ? (r.halfTimeMinutes ?? 10) : periods === 4 ? (key === 'basketball' ? 2 + 15 + 2 : 2 + 10 + 2) : 0;
    const stoppages = key === 'basketball' ? 1.5 : 1; // the clock stops in basketball
    return up5(periods * r.periodMinutes * stoppages + breaks + 10);
  }
  if (key === 'chess') {
    const base2 = (r.baseMinutes ?? 5) * 2 + ((r.incrementSeconds ?? 0) * 40 * 2) / 60; // 40 moves each
    return up5(base2 + 5);
  }
  const want = playUnits(key, r); const was = playUnits(key, std);
  if (want == null || !was) return null;
  return up5((base * want) / was);
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
 * A rally or carrom match's game rules, in the shape the server's set rollup
 * takes (and the app's rally engine, via its own field names). One source for
 * both — the numbers used to be hand-copied into each.
 */
export function setConfigOf(rules: MatchRules): { target: number; cap?: number; maxSets: number; finalTarget?: number; winBy2: boolean } {
  return {
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
export function chessClockLabel(baseMinutes: number, incrementSeconds = 0): string {
  const t = baseMinutes + incrementSeconds;
  if (t < 3) return 'Bullet';
  if (t <= 10) return 'Blitz';
  if (t < 60) return 'Rapid';
  return 'Classical';
}

/** BUILD 3.67: a chess clock's limits. */
export const CHESS_BASE_MINUTES: [number, number] = [1, 120];
export const CHESS_INCREMENT_SECONDS: [number, number] = [0, 60];

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
    return { format: `${chessClockLabel(b, i)} · ${b}+${i}`, overs: null };
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
export const CHESS_CLOCKS: Array<[number, number]> = [[1, 0], [5, 0], [3, 2], [10, 0], [15, 10], [30, 0]];

type Refusal = { error: string; code: 'BAD_RULES'; field: string | null };
const refuse = (error: string, field: string | null = null): Refusal => ({ error, code: 'BAD_RULES', field });

const FIELD_NAMES: Record<string, string> = {
  style: 'Match type', overs: 'Overs', players: 'Players a side', lastManStands: 'Last man stands', retireAt: 'Retire at', bowlerOvers: 'Max overs per bowler', extraRuns: 'Wide / no-ball runs', rebowl: 'Re-bowl wides and no-balls', freeHit: 'Free hit', inningsMinutes: 'Innings time cap', powerplayOvers: 'Powerplay overs', oneTipOneHand: 'One tip, one hand', sixAndOut: 'Six and out', noLbw: 'No LBW', bestOf: 'Match length', target: 'Points to win a game', cap: 'Point cap',
  finalTarget: 'Deciding game target', winBy2: 'Win by 2', periods: 'Periods', periodMinutes: 'Period length', halfTimeMinutes: 'Half-time', penaltyKicks: 'Penalty kicks', extraTimeMinutes: 'Extra time', walkoverGoals: 'Walkover score', rollingSubs: 'Rolling subs', offside: 'Offside', sinBinMinutes: 'Sin bin', shootoutTakers: 'Shoot-out takers', yellowCardMinutes: 'Yellow card', overtimeMinutes: 'Overtime', targetScore: 'First to', pointSet: 'Points', foulOut: 'Foul-out', timeoutsPerSet: 'Timeouts a set', rubbers: 'Rubbers', scoring: 'Scoring', gamesPerSet: 'Games a set', tiebreak: 'Tiebreak', tiebreakTo: 'Tiebreak points', matchTiebreak: 'Match tiebreak', adScoring: 'Game scoring', timeLimitMinutes: 'Time limit', tiebreakAt: 'Tiebreak at', finalSetTiebreakTo: 'Final-set tiebreak', noLet: 'Lets', ballChange: 'New balls', queenPoints: 'Queen', queenCutoff: 'Queen cut-off', boardCap: 'Boards a game', gameMinutes: 'Minutes a game', carromMode: 'Carrom game', queenValue: 'Queen (point carrom)',
  drawAllowed: 'Draws', baseMinutes: 'Clock', incrementSeconds: 'Increment',
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
      return refuse(`Overs must be a whole number from ${OVERS_MIN} to ${OVERS_MAX}.`, 'overs');
    }
    // BUILD 3.2: players a side, or null (the line-up decides).
    if (r.players !== null && (!isWhole(r.players) || r.players < PLAYERS_MIN || r.players > PLAYERS_MAX)) {
      return refuse(`Players a side must be a whole number from ${PLAYERS_MIN} to ${PLAYERS_MAX}.`, 'players');
    }
    if (typeof r.lastManStands !== 'boolean') return refuse('Last man stands is on or off.', 'lastManStands');
    if (r.retireAt !== null && (!isWhole(r.retireAt) || r.retireAt < RETIRE_MIN || r.retireAt > RETIRE_MAX)) {
      return refuse(`Retire at must be off, or a whole number of runs from ${RETIRE_MIN} to ${RETIRE_MAX}.`, 'retireAt');
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
      return refuse(`A wide or no-ball must be worth ${EXTRA_RUNS_MIN}, 1 or ${EXTRA_RUNS_MAX} runs.`, 'extraRuns');
    }
    if (typeof r.rebowl !== 'boolean') return refuse('Re-bowl wides and no-balls is on or off.', 'rebowl');
    if (typeof r.freeHit !== 'boolean') return refuse('Free hit is on or off.', 'freeHit');
    if (r.inningsMinutes !== null && (!isWhole(r.inningsMinutes) || r.inningsMinutes < INNINGS_MINUTES_MIN || r.inningsMinutes > INNINGS_MINUTES_MAX)) {
      return refuse(`An innings time cap must be off, or ${INNINGS_MINUTES_MIN} to ${INNINGS_MINUTES_MAX} minutes.`, 'inningsMinutes');
    }
    if (r.powerplayOvers !== null && (!isWhole(r.powerplayOvers) || r.powerplayOvers < 1 || r.powerplayOvers > (r.overs as number))) {
      return refuse(`Powerplay overs must be off, or a whole number from 1 to ${String(r.overs)}.`, 'powerplayOvers');
    }
    if (typeof r.oneTipOneHand !== 'boolean') return refuse('One tip, one hand is on or off.', 'oneTipOneHand');
    if (typeof r.sixAndOut !== 'boolean') return refuse('Six and out is on or off.', 'sixAndOut');
    if (typeof r.noLbw !== 'boolean') return refuse('No LBW is on or off.', 'noLbw');
  }
  // BUILD 3.72: carrom — a game to 7–29, the queen worth 0–5.
  if (key === 'carrom' && (!isWhole(r.target) || r.target < 7 || r.target > 29)) return refuse('Points to win a game must be 7 to 29.', 'target');
  if (key === 'carrom' && (!isWhole(r.queenPoints) || r.queenPoints < 0 || r.queenPoints > 5)) return refuse('The queen is worth 0 to 5.', 'queenPoints');
  if (key === 'carrom' && typeof r.queenCutoff !== 'boolean') return refuse('The queen cut-off is on or off.', 'queenCutoff'); // BUILD 3.73
  if (key === 'carrom' && r.boardCap !== null && (!isWhole(r.boardCap) || r.boardCap < 1 || r.boardCap > 12)) return refuse('Boards a game must be off, or 1 to 12.', 'boardCap'); // BUILD 3.74
  if (key === 'carrom' && r.carromMode !== 'board' && r.carromMode !== 'points') return refuse('Carrom is scored by boards or by points.', 'carromMode'); // BUILD 3.77
  if (key === 'carrom' && r.queenValue !== 25 && r.queenValue !== 50) return refuse('In point carrom the queen is 25 or 50.', 'queenValue');
  if (key === 'carrom' && r.gameMinutes !== null && (!isWhole(r.gameMinutes) || r.gameMinutes < 5 || r.gameMinutes > 60)) return refuse('A game’s time must be off, or 5 to 60 minutes.', 'gameMinutes'); // BUILD 3.76
  // BUILD 3.59: tennis games a set, short set (4) to pro set (10).
  if (key === 'tennis' && (!isWhole(r.gamesPerSet) || r.gamesPerSet < 4 || r.gamesPerSet > 10)) {
    return refuse('Games a set must be 4 to 10.', 'gamesPerSet');
  }
  if (key === 'tennis' && typeof r.tiebreak !== 'boolean') return refuse('A tiebreak is on or off.', 'tiebreak'); // BUILD 3.60
  if (key === 'tennis' && r.tiebreakTo !== 7 && r.tiebreakTo !== 10) return refuse('A tiebreak is to 7 or 10 points.', 'tiebreakTo'); // BUILD 3.61
  if (key === 'tennis' && typeof r.matchTiebreak !== 'boolean') return refuse('A match tiebreak is on or off.', 'matchTiebreak'); // BUILD 3.62
  if (key === 'tennis' && r.timeLimitMinutes !== null && (!isWhole(r.timeLimitMinutes) || r.timeLimitMinutes < 10 || r.timeLimitMinutes > 180)) {
    return refuse('A time limit must be off, or 10 to 180 minutes.', 'timeLimitMinutes'); // BUILD 3.66
  }
  if (key === 'tennis' && r.players !== null && r.players !== DOUBLES_PLAYERS) return refuse('Tennis players a side is 2 (doubles), or not set for singles.', 'players'); // BUILD 3.65
  if (key === 'tennis' && r.adScoring !== 'ad' && r.adScoring !== 'noad' && r.adScoring !== 'semiad') return refuse('Games are ad, no-ad or semi-ad.', 'adScoring'); // BUILD 3.63
  if (key === 'tennis' && r.matchTiebreak === true && r.bestOf === 1) return refuse('A match tiebreak replaces a final set — there is none in a one-set match.', 'matchTiebreak');
  // Stage 9 · T2: Fast4's early tiebreak, the Grand Slams' final-set tiebreak, no lets.
  if (key === 'tennis' && r.tiebreakAt !== null && (!isWhole(r.tiebreakAt) || r.tiebreakAt < 1 || r.tiebreakAt > (r.gamesPerSet as number))) {
    return refuse(`A tiebreak comes at 1-all to ${String(r.gamesPerSet)}-all.`, 'tiebreakAt');
  }
  if (key === 'tennis' && r.tiebreakAt !== null && r.tiebreak === false) return refuse('Set when the tiebreak comes only with tiebreaks on.', 'tiebreakAt');
  if (key === 'tennis' && r.finalSetTiebreakTo !== null && r.finalSetTiebreakTo !== 7 && r.finalSetTiebreakTo !== 10) return refuse('A final-set tiebreak is to 7 or 10 points.', 'finalSetTiebreakTo');
  if (key === 'tennis' && r.finalSetTiebreakTo !== null && (r.matchTiebreak === true || r.tiebreak === false)) {
    return refuse(r.matchTiebreak === true ? 'With a match tiebreak there’s no final set to give its own tiebreak.' : 'A final-set tiebreak needs tiebreaks on.', 'finalSetTiebreakTo');
  }
  if (key === 'tennis' && typeof r.noLet !== 'boolean') return refuse('Lets are on or off.', 'noLet');
  if (key === 'tennis' && typeof r.ballChange !== 'boolean') return refuse('New balls are on or off.', 'ballChange'); // Stage 9 · T10
  // BUILD 3.58: pickleball scores every rally, or side-out (doubles: players 2).
  if (key === 'pickleball' && r.scoring !== 'rally' && r.scoring !== 'sideout') return refuse('Scoring is rally or side-out.', 'scoring');
  if (key === 'pickleball' && r.players !== null && r.players !== DOUBLES_PLAYERS) {
    return refuse('Pickleball players a side is 2 (doubles), or not set for singles.', 'players');
  }
  // BUILD 3.56: pickleball plays win by 2, or a golden point (winBy2 false).
  if (key === 'pickleball' && typeof r.winBy2 !== 'boolean') return refuse('Win by 2 is on or off (golden point).', 'winBy2');
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
  if (side && r.players !== null && (!isWhole(r.players) || r.players < side[0] || r.players > side[1])) {
    return refuse(`Players a side must be a whole number from ${side[0]} to ${side[1]}.`, 'players');
  }
  // BUILD 3.17: a timed sport's periods, their length and (football) half-time.
  const timed = TIMED_LIMITS[key];
  if (timed) {
    if (!isWhole(r.periods) || r.periods < timed.periods[0] || r.periods > timed.periods[1]) {
      return refuse(`Periods must be a whole number from ${timed.periods[0]} to ${timed.periods[1]}.`, 'periods');
    }
    if (r.periodMinutes !== null && (!isWhole(r.periodMinutes) || r.periodMinutes < timed.minutes[0] || r.periodMinutes > timed.minutes[1])) {
      return refuse(`A period must be off, or ${timed.minutes[0]} to ${timed.minutes[1]} minutes.`, 'periodMinutes');
    }
    if ('halfTimeMinutes' in stdMap && r.halfTimeMinutes !== null && (!isWhole(r.halfTimeMinutes) || r.halfTimeMinutes < 0 || r.halfTimeMinutes > HALF_TIME_MAX)) {
      return refuse(`Half-time must be off, or 0 to ${HALF_TIME_MAX} minutes.`, 'halfTimeMinutes');
    }
  }
  // BUILD 3.18: 3 or 5 penalties each, then sudden death.
  if (key === 'football' && r.penaltyKicks !== 3 && r.penaltyKicks !== 5) {
    return refuse('Penalty kicks must be 3 or 5 each.', 'penaltyKicks');
  }
  // BUILD 3.23: two on/off flags, shown on the match (no effect on scoring).
  if (key === 'football' && typeof r.rollingSubs !== 'boolean') return refuse('Rolling subs is on or off.', 'rollingSubs');
  if (key === 'football' && typeof r.offside !== 'boolean') return refuse('Offside is on or off.', 'offside');
  // BUILD 3.35: foul out at 5 or 6.
  if (key === 'basketball' && r.foulOut !== 5 && r.foulOut !== 6) return refuse('A player fouls out at 5 or 6.', 'foulOut');
  // BUILD 3.33: 1-2-3 (5v5) or 1-2 (3x3).
  if (key === 'basketball' && r.pointSet !== '123' && r.pointSet !== '12') return refuse('Points are 1-2-3 or 1-2.', 'pointSet');
  // BUILD 3.32: first to 7–50, or off.
  if (key === 'basketball' && r.targetScore !== null && (!isWhole(r.targetScore) || r.targetScore < 7 || r.targetScore > 50)) {
    return refuse('First to must be off, or 7 to 50 points.', 'targetScore');
  }
  // BUILD 3.31: basketball overtime, 1–5 minutes.
  if (key === 'basketball' && (!isWhole(r.overtimeMinutes) || r.overtimeMinutes < 1 || r.overtimeMinutes > 5)) {
    return refuse('Overtime must be 1 to 5 minutes.', 'overtimeMinutes');
  }
  // BUILD 3.29: a hockey yellow card suspends for 5–10 minutes.
  if (key === 'hockey' && (!isWhole(r.yellowCardMinutes) || r.yellowCardMinutes < 5 || r.yellowCardMinutes > 10)) {
    return refuse('A yellow card must suspend for 5 to 10 minutes.', 'yellowCardMinutes');
  }
  // BUILD 3.27: hockey's shoot-out takers, 1–5.
  if (key === 'hockey' && (!isWhole(r.shootoutTakers) || r.shootoutTakers < 1 || r.shootoutTakers > 5)) {
    return refuse('Shoot-out takers must be 1 to 5 each.', 'shootoutTakers');
  }
  // BUILD 3.24: a sin bin of 2–15 minutes, or none.
  if (key === 'football' && r.sinBinMinutes !== null && (!isWhole(r.sinBinMinutes) || r.sinBinMinutes < 2 || r.sinBinMinutes > 15)) {
    return refuse('A sin bin must be off, or 2 to 15 minutes.', 'sinBinMinutes');
  }
  // Stage 8 · F1/F4: an organiser's substitutions limit and windows (optional; no app top), golden goal (F10), the fewest on the pitch (F15).
  if (key === 'football' && r.maxSubs != null && (!isWhole(r.maxSubs) || r.maxSubs < 0)) return refuse('Substitutions must be a whole number, or no limit.', 'maxSubs');
  if (key === 'football' && r.subWindows != null && (!isWhole(r.subWindows) || r.subWindows < 1)) return refuse('Substitution windows must be 1 or more, or any.', 'subWindows');
  if (key === 'football' && r.goldenGoal != null && typeof r.goldenGoal !== 'boolean') return refuse('Golden goal is on or off.', 'goldenGoal');
  if (key === 'football' && r.minOnPitch != null && (!isWhole(r.minOnPitch) || r.minOnPitch < 1 || (isWhole(r.players) && r.minOnPitch > r.players))) {
    return refuse('The fewest players on the pitch must be from 1 to the players a side.', 'minOnPitch');
  }
  // BUILD 3.21: a walkover goes down as 3–0 or 5–0.
  if (key === 'football' && r.walkoverGoals !== 3 && r.walkoverGoals !== 5) return refuse('A walkover is 3–0 or 5–0.', 'walkoverGoals');
  // BUILD 3.20: whether a league / group match may end level.
  if (key === 'football' && typeof r.drawAllowed !== 'boolean') return refuse('Draws are allowed or not.', 'drawAllowed');
  // BUILD 3.19: extra time, 0 (none) to 15 minutes a half.
  if (key === 'football' && (!isWhole(r.extraTimeMinutes) || r.extraTimeMinutes < 0 || r.extraTimeMinutes > EXTRA_TIME_MAX)) {
    return refuse(`Extra time must be off, or up to ${EXTRA_TIME_MAX} minutes a half.`, 'extraTimeMinutes');
  }
  // BUILD 3.42: volleyball timeouts a set, 0–3.
  if (key === 'volleyball' && (!isWhole(r.timeoutsPerSet) || r.timeoutsPerSet < 0 || r.timeoutsPerSet > 3)) {
    return refuse('Timeouts must be 0 to 3 a set.', 'timeoutsPerSet');
  }
  // BUILD 3.37: a rally sport's points to win a set.
  const rally = RALLY_LIMITS[key];
  if (rally && (!isWhole(r.target) || r.target < rally.target[0] || r.target > rally.target[1])) {
    return refuse(`Points to win a ${rally.unit ?? 'set'} must be ${rally.target[0]} to ${rally.target[1]}.`, 'target');
  }
  // BUILD 3.39: a cap — off, or the target to target + span, and never below
  // the deciding set's target (it couldn't be reached).
  if (rally?.capSpan != null && r.cap !== null) {
    const hi = (r.target as number) + rally.capSpan;
    const lo = Math.max(r.target as number, typeof r.finalTarget === 'number' ? r.finalTarget : 0);
    if (!isWhole(r.cap) || r.cap < lo || r.cap > hi) {
      return refuse(lo > hi ? 'A cap can’t fit this deciding set — turn the cap off.' : `The cap must be off, or ${lo} to ${hi}.`, 'cap');
    }
  }
  // BUILD 3.38: the deciding set's points (null = the same as the others).
  if (rally?.finalTarget && r.finalTarget !== null && (!isWhole(r.finalTarget) || r.finalTarget < rally.finalTarget[0] || r.finalTarget > rally.finalTarget[1])) {
    return refuse(`The deciding set must be ${rally.finalTarget[0]} to ${rally.finalTarget[1]} points.`, 'finalTarget');
  }
  if (MATCH_LENGTHS[key]) {
    const offered = MATCH_LENGTHS[key]!.options;
    if (!isWhole(r.bestOf) || !(offered as number[]).includes(r.bestOf)) return refuse(`Match length must be best of ${listOf(offered)}.`, 'bestOf');
  }
  if (key === 'chess') {
    // BUILD 3.67: any clock — 1–120 minutes plus 0–60 seconds a move (the chips are presets).
    if (!isWhole(r.baseMinutes) || r.baseMinutes < CHESS_BASE_MINUTES[0] || r.baseMinutes > CHESS_BASE_MINUTES[1]) {
      return refuse(`The clock must be ${CHESS_BASE_MINUTES[0]} to ${CHESS_BASE_MINUTES[1]} minutes.`, 'baseMinutes');
    }
    if (!isWhole(r.incrementSeconds) || r.incrementSeconds < CHESS_INCREMENT_SECONDS[0] || r.incrementSeconds > CHESS_INCREMENT_SECONDS[1]) {
      return refuse(`The increment must be ${CHESS_INCREMENT_SECONDS[0]} to ${CHESS_INCREMENT_SECONDS[1]} seconds a move.`, 'incrementSeconds');
    }
  }
  // Everything else is fixed at the sport's standard for now.
  const open = new Set(['style', 'overs', 'players', 'lastManStands', 'retireAt', 'bowlerOvers', 'extraRuns', 'rebowl', 'freeHit', 'inningsMinutes', 'powerplayOvers', 'oneTipOneHand', 'sixAndOut', 'noLbw', 'bestOf', 'baseMinutes', 'incrementSeconds',
    ...(timed ? ['periods', 'periodMinutes', 'halfTimeMinutes'] : []), ...(key === 'volleyball' ? ['timeoutsPerSet'] : []), ...(key === 'badminton' || key === 'tabletennis' ? ['rubbers'] : []), ...(key === 'pickleball' ? ['winBy2', 'scoring'] : []), ...(key === 'carrom' ? ['target', 'queenPoints', 'queenCutoff', 'boardCap', 'gameMinutes', 'carromMode', 'queenValue'] : []), ...(key === 'tennis' ? ['gamesPerSet', 'tiebreak', 'tiebreakTo', 'matchTiebreak', 'adScoring', 'timeLimitMinutes', 'tiebreakAt', 'finalSetTiebreakTo', 'noLet', 'ballChange'] : []), ...(rally ? ['target', ...(rally.finalTarget ? ['finalTarget'] : []), ...(rally.capSpan != null ? ['cap'] : [])] : []), ...(key === 'hockey' ? ['shootoutTakers', 'yellowCardMinutes'] : []), ...(key === 'basketball' ? ['overtimeMinutes', 'targetScore', 'pointSet', 'foulOut'] : []), ...(key === 'football' ? ['penaltyKicks', 'extraTimeMinutes', 'drawAllowed', 'walkoverGoals', 'rollingSubs', 'offside', 'sinBinMinutes', 'maxSubs', 'subWindows', 'goldenGoal', 'minOnPitch'] : [])]);
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
  football: { periods: [1, 4], minutes: [5, 45] },
  hockey: { periods: [1, 4], minutes: [5, 35] }, // BUILD 3.25
  basketball: { periods: [1, 4], minutes: [3, 20] }, // BUILD 3.30 (length shown only — no clock)
};
export const HALF_TIME_MAX = 20;
/** BUILD 3.19: extra time's longest half. */
export const EXTRA_TIME_MAX = 15;

/** BUILD 3.16: a football side, 3 (futsal-ish) to 11. */
export const FOOTBALL_PLAYERS_MIN = 3;
export const FOOTBALL_PLAYERS_MAX = 11;
/** BUILD 3.26: a hockey side, 4 (small-sided turf) to 11. */
export const HOCKEY_PLAYERS_MIN = 4;
export const HOCKEY_PLAYERS_MAX = 11;
/** BUILD 3.34: a basketball side, 1 (one-on-one) to 5. */
export const BASKETBALL_PLAYERS_MIN = 1;
export const BASKETBALL_PLAYERS_MAX = 5;
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
export const BEACH_VOLLEYBALL = { players: 2, target: 21, finalTarget: 15, bestOf: 3, timeoutsPerSet: 1 } as const; // BUILD 3.42: one timeout a set on the beach

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

/** BUILD 3.28: FIH Hockey5s — 5 a side, two halves of 10 minutes. */
export const HOCKEY5S = { players: 5, periods: 2, periodMinutes: 10 } as const;
const SIDE_LIMITS: Record<string, [number, number]> = {
  football: [FOOTBALL_PLAYERS_MIN, FOOTBALL_PLAYERS_MAX],
  hockey: [HOCKEY_PLAYERS_MIN, HOCKEY_PLAYERS_MAX],
  basketball: [BASKETBALL_PLAYERS_MIN, BASKETBALL_PLAYERS_MAX], // BUILD 3.34
  volleyball: [2, 9], // BUILD 3.40: beach 2, indoor 6, 9-a-side
};

/**
 * BUILD 3.16+ · the rules of a timed team sport in words, for the pad and
 * Match Detail headers ("7-a-side"). Parts the match doesn't set are left out.
 */
export function timedRulesLabel(sport: string | null | undefined, rules: MatchRules): string | null {
  const key = lengthKey(sport);
  const parts: string[] = [];
  // BUILD 3.37+: a rally sport's own points, said when they differ from the standard.
  if (RALLY_LIMITS[key]) {
    const std = SPORT_RULES[key] ?? {};
    if (rules.rubbers) parts.push(key === 'tabletennis' && TT_TIES[rules.rubbers] ? `${TT_TIES[rules.rubbers]!.name} · ${rules.rubbers} rubbers` : `team tie · ${rules.rubbers} rubbers`); // BUILD 3.49 / 3.54
    if (rules.players) parts.push(key === 'badminton' || key === 'pickleball' ? 'doubles' : `${rules.players}-a-side`); // BUILD 3.40 / 3.47 / 3.58
    if (rules.target != null && rules.target !== std.target) parts.push(`${RALLY_LIMITS[key]!.unit ?? 'set'}s to ${rules.target}`); // BUILD 3.44: badminton plays games
    if (rules.cap !== undefined && rules.cap !== std.cap) parts.push(rules.cap == null ? 'no cap' : `cap ${rules.cap}`); // BUILD 3.39
    if (key === 'pickleball' && rules.scoring === 'sideout') parts.push('side-out scoring'); // BUILD 3.58
    if (key === 'pickleball' && rules.winBy2 === false) parts.push('golden point'); // BUILD 3.56
    if (rules.timeoutsPerSet != null && rules.timeoutsPerSet !== std.timeoutsPerSet) parts.push(rules.timeoutsPerSet === 0 ? 'no timeouts' : `${rules.timeoutsPerSet} timeout${rules.timeoutsPerSet === 1 ? '' : 's'} a set`); // BUILD 3.42
    if (rules.finalTarget !== undefined && rules.finalTarget !== std.finalTarget) parts.push(rules.finalTarget == null ? 'decider the same' : `decider to ${rules.finalTarget}`); // BUILD 3.38
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
  if (key === 'basketball' && rules.pointSet === '12') parts.push('1s and 2s'); // BUILD 3.33
  if (key === 'basketball' && rules.foulOut === 6) parts.push('foul out at 6'); // BUILD 3.35 (5 left unsaid)
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
