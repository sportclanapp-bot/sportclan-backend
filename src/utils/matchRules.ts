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
