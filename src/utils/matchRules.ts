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
import { CRICKET_OVERS } from './cricketRules';

export const RULES_VERSION = 1;

export type CricketStyle = 'limited' | 'box' | 'pair';

/** Every field is optional in the type; a sport uses the ones in its standard. */
export interface MatchRules {
  v: 1;
  /** Cricket: limited overs / box / pair, and overs per innings. */
  style?: CricketStyle;
  overs?: number;
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
  cricket: { style: 'limited', overs: 20, drawAllowed: true },
  badminton: { bestOf: 3, target: 21, cap: 30, finalTarget: null, winBy2: true },
  tabletennis: { bestOf: 5, target: 11, cap: null, finalTarget: null, winBy2: true },
  pickleball: { bestOf: 3, target: 11, cap: null, finalTarget: null, winBy2: true },
  volleyball: { bestOf: 5, target: 25, cap: null, finalTarget: 15, winBy2: true },
  tennis: { bestOf: 3 },
  carrom: { bestOf: 3, target: 25, cap: null, finalTarget: null, winBy2: false },
  football: { periods: 2, periodMinutes: null, drawAllowed: true },
  hockey: { periods: 4, periodMinutes: null, drawAllowed: true },
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
 *            `overs`, else a "T<n>" format, else 20 (inningsOvers' default)
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
    const t = /^t(\d{1,3})$/i.exec(f);
    const n = overs != null && Number.isFinite(Number(overs)) && Number(overs) > 0
      ? Math.floor(Number(overs))
      : t ? Number(t[1]) : 20;
    rules.overs = n;
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
  style: 'Match type', overs: 'Overs', bestOf: 'Match length', target: 'Points to win a game', cap: 'Point cap',
  finalTarget: 'Deciding game target', winBy2: 'Win by 2', periods: 'Periods', periodMinutes: 'Period length',
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
    const offered = CRICKET_OVERS[r.style as CricketStyle].options;
    if (!isWhole(r.overs) || !offered.includes(r.overs)) {
      return refuse(`Overs must be ${listOf(offered)} for ${r.style === 'limited' ? 'limited overs' : `${r.style} cricket`}.`, 'overs');
    }
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
  const open = new Set(['style', 'overs', 'bestOf', 'baseMinutes', 'incrementSeconds']);
  for (const k of Object.keys(stdMap)) {
    if (open.has(k)) continue;
    if (r[k] !== stdMap[k]) return refuse(`${FIELD_NAMES[k] ?? k} can’t be changed for this sport yet.`, k);
  }
  return null;
}
