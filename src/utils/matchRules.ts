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
  /** BUILD 3.27: hockey's shoot-out takers each before sudden death (1–5). */
  shootoutTakers?: number;
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
  cricket: { style: 'limited', overs: 20, players: null, lastManStands: false, retireAt: null, bowlerOvers: null, extraRuns: 1, rebowl: true, freeHit: false, inningsMinutes: null, powerplayOvers: null, oneTipOneHand: false, sixAndOut: false, drawAllowed: true },
  badminton: { bestOf: 3, target: 21, cap: 30, finalTarget: null, winBy2: true },
  tabletennis: { bestOf: 5, target: 11, cap: null, finalTarget: null, winBy2: true },
  pickleball: { bestOf: 3, target: 11, cap: null, finalTarget: null, winBy2: true },
  volleyball: { bestOf: 5, target: 25, cap: null, finalTarget: 15, winBy2: true },
  tennis: { bestOf: 3 },
  carrom: { bestOf: 3, target: 25, cap: null, finalTarget: null, winBy2: false },
  football: { players: null, periods: 2, periodMinutes: null, halfTimeMinutes: null, penaltyKicks: 5, extraTimeMinutes: 0, walkoverGoals: 3, rollingSubs: false, offside: true, sinBinMinutes: null, drawAllowed: true },
  hockey: { players: null, periods: 4, periodMinutes: null, shootoutTakers: 5, drawAllowed: true },
  basketball: { periods: 4, periodMinutes: null, drawAllowed: false },
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

/** Games / sets / boards needed to win a best-of-n match. */
export function winsToWin(rules: MatchRules): number {
  return Math.floor((rules.bestOf ?? 1) / 2) + 1;
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

/** "Bullet", "Blitz", "Rapid", "Classical" for a clock (the create form's names). */
export function chessClockLabel(baseMinutes: number): string {
  if (baseMinutes < 3) return 'Bullet';
  if (baseMinutes < 10) return 'Blitz';
  if (baseMinutes < 30) return 'Rapid';
  return 'Classical';
}

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
    return { format: `${chessClockLabel(b)} · ${b}+${i}`, overs: null };
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
  style: 'Match type', overs: 'Overs', players: 'Players a side', lastManStands: 'Last man stands', retireAt: 'Retire at', bowlerOvers: 'Max overs per bowler', extraRuns: 'Wide / no-ball runs', rebowl: 'Re-bowl wides and no-balls', freeHit: 'Free hit', inningsMinutes: 'Innings time cap', powerplayOvers: 'Powerplay overs', oneTipOneHand: 'One tip, one hand', sixAndOut: 'Six and out', bestOf: 'Match length', target: 'Points to win a game', cap: 'Point cap',
  finalTarget: 'Deciding game target', winBy2: 'Win by 2', periods: 'Periods', periodMinutes: 'Period length', halfTimeMinutes: 'Half-time', penaltyKicks: 'Penalty kicks', extraTimeMinutes: 'Extra time', walkoverGoals: 'Walkover score', rollingSubs: 'Rolling subs', offside: 'Offside', sinBinMinutes: 'Sin bin', shootoutTakers: 'Shoot-out takers',
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
  // BUILD 3.27: hockey's shoot-out takers, 1–5.
  if (key === 'hockey' && (!isWhole(r.shootoutTakers) || r.shootoutTakers < 1 || r.shootoutTakers > 5)) {
    return refuse('Shoot-out takers must be 1 to 5 each.', 'shootoutTakers');
  }
  // BUILD 3.24: a sin bin of 2–15 minutes, or none.
  if (key === 'football' && r.sinBinMinutes !== null && (!isWhole(r.sinBinMinutes) || r.sinBinMinutes < 2 || r.sinBinMinutes > 15)) {
    return refuse('A sin bin must be off, or 2 to 15 minutes.', 'sinBinMinutes');
  }
  // BUILD 3.21: a walkover goes down as 3–0 or 5–0.
  if (key === 'football' && r.walkoverGoals !== 3 && r.walkoverGoals !== 5) return refuse('A walkover is 3–0 or 5–0.', 'walkoverGoals');
  // BUILD 3.20: whether a league / group match may end level.
  if (key === 'football' && typeof r.drawAllowed !== 'boolean') return refuse('Draws are allowed or not.', 'drawAllowed');
  // BUILD 3.19: extra time, 0 (none) to 15 minutes a half.
  if (key === 'football' && (!isWhole(r.extraTimeMinutes) || r.extraTimeMinutes < 0 || r.extraTimeMinutes > EXTRA_TIME_MAX)) {
    return refuse(`Extra time must be off, or up to ${EXTRA_TIME_MAX} minutes a half.`, 'extraTimeMinutes');
  }
  if (MATCH_LENGTHS[key]) {
    const offered = MATCH_LENGTHS[key]!.options;
    if (!isWhole(r.bestOf) || !(offered as number[]).includes(r.bestOf)) return refuse(`Match length must be best of ${listOf(offered)}.`, 'bestOf');
  }
  if (key === 'chess') {
    if (!CHESS_CLOCKS.some(([b, i]) => r.baseMinutes === b && r.incrementSeconds === i)) {
      return refuse(`The clock must be one of ${CHESS_CLOCKS.map(([b, i]) => `${b}+${i}`).join(', ')}.`, 'baseMinutes');
    }
  }
  // Everything else is fixed at the sport's standard for now.
  const open = new Set(['style', 'overs', 'players', 'lastManStands', 'retireAt', 'bowlerOvers', 'extraRuns', 'rebowl', 'freeHit', 'inningsMinutes', 'powerplayOvers', 'oneTipOneHand', 'sixAndOut', 'bestOf', 'baseMinutes', 'incrementSeconds',
    ...(timed ? ['periods', 'periodMinutes', 'halfTimeMinutes'] : []), ...(key === 'hockey' ? ['shootoutTakers'] : []), ...(key === 'football' ? ['penaltyKicks', 'extraTimeMinutes', 'drawAllowed', 'walkoverGoals', 'rollingSubs', 'offside', 'sinBinMinutes'] : [])]);
  for (const k of Object.keys(stdMap)) {
    if (open.has(k)) continue;
    if (r[k] !== stdMap[k]) return refuse(`${FIELD_NAMES[k] ?? k} can’t be changed for this sport yet.`, k);
  }
  return null;
}

/** BUILD 3.17: the periods and period lengths a timed sport may set (others stay standard). */
export const TIMED_LIMITS: Record<string, { periods: [number, number]; minutes: [number, number] }> = {
  football: { periods: [1, 4], minutes: [5, 45] },
  hockey: { periods: [1, 4], minutes: [5, 35] }, // BUILD 3.25
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
const SIDE_LIMITS: Record<string, [number, number]> = {
  football: [FOOTBALL_PLAYERS_MIN, FOOTBALL_PLAYERS_MAX],
  hockey: [HOCKEY_PLAYERS_MIN, HOCKEY_PLAYERS_MAX],
};

/**
 * BUILD 3.16+ · the rules of a timed team sport in words, for the pad and
 * Match Detail headers ("7-a-side"). Parts the match doesn't set are left out.
 */
export function timedRulesLabel(sport: string | null | undefined, rules: MatchRules): string | null {
  const key = lengthKey(sport);
  if (key !== 'football' && key !== 'hockey' && key !== 'basketball') return null;
  const parts: string[] = [];
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

export type Stage = 'group' | 'knockout' | 'final';
export const STAGE_KEYS = ['default', 'group', 'knockout', 'final'] as const;
export type TournamentRules = Partial<Record<(typeof STAGE_KEYS)[number], Partial<MatchRules>>>;

/** The rules a fixture in `stage` plays by. */
export function stageRules(sport: string | null | undefined, rules: unknown, stage: Stage): MatchRules {
  const t = (rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {}) as Record<string, unknown>;
  const chain = stage === 'final' ? ['final', 'knockout', 'default'] : stage === 'knockout' ? ['knockout', 'default'] : ['group', 'default'];
  const hit = chain.map((k) => t[k]).find((r) => r && typeof r === 'object' && !Array.isArray(r));
  return normalizeRules(sport, hit ?? { v: 1 });
}

/** Why a tournament's stage rules can't be used, or null. Each stage is checked by rulesRefusal. */
export function tournamentRulesRefusal(sport: string | null | undefined, rules: unknown): Refusal | null {
  if (rules === null || rules === undefined) return null;
  if (typeof rules !== 'object' || Array.isArray(rules)) return refuse('Tournament match rules must be an object.');
  const labels: Record<string, string> = { default: 'Every match', group: 'Group / league matches', knockout: 'Knockout matches', final: 'The final' };
  for (const [k, v] of Object.entries(rules as Record<string, unknown>)) {
    if (!(STAGE_KEYS as readonly string[]).includes(k)) return refuse(`${k} isn’t a tournament stage (default, group, knockout or final).`, k);
    const bad = rulesRefusal(sport, v);
    if (bad) return { ...bad, error: `${labels[k]}: ${bad.error}` };
  }
  return null;
}
