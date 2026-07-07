/**
 * Shared validation + lifecycle helpers (Batch-2 fixes).
 */

// ── Match lifecycle (SC-42) ──────────────────────────────────────────────────
// Once a match reaches a terminal status it is immutable: no more scoring
// events, toss, event edits, or result changes.
export const TERMINAL_MATCH_STATUSES = ['completed', 'abandoned', 'cancelled'] as const;

export function isTerminalMatchStatus(status?: string | null): boolean {
  return !!status && (TERMINAL_MATCH_STATUSES as readonly string[]).includes(status);
}

// ── Tournament format (SC-37) ────────────────────────────────────────────────
export const TOURNAMENT_FORMATS = ['knockout', 'league', 'round_robin', 'groups_knockout'] as const;

export function isValidTournamentFormat(format?: string | null): boolean {
  return !!format && (TOURNAMENT_FORMATS as readonly string[]).includes(format);
}

// ── Bounds (SC-38 / SC-39 + length caps) ─────────────────────────────────────
export const LIMITS = {
  tournamentMinTeams: 2,
  tournamentMaxTeams: 64,
  expenseMaxAmount: 100_000_000, // 10 crore — generous ceiling, blocks overflow/absurd
  postTextMax: 500, // matches the community_posts / post_comments DB CHECK
  bioMax: 500,
  teamNameMax: 60,
  // SC-95 length caps for previously-unbounded user text.
  tournamentNameMax: 120,
  descriptionMax: 2000,
  groupNameMax: 60,
  urlMax: 2048,
} as const;

// SC-96: a well-formed http(s) URL within the length cap. Empty/null is handled
// by the callers (clearing a field is allowed) — this only judges present values.
export function isValidHttpUrl(v: unknown): boolean {
  if (typeof v !== 'string' || v.length === 0 || v.length > LIMITS.urlMax) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** First url field in `keys` whose (present, non-empty) value isn't a valid http(s) URL, or null. */
export function firstInvalidUrl(obj: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null || v === '') continue; // absent / clearing → allowed
    if (!isValidHttpUrl(v)) return k;
  }
  return null;
}

/** First [key, max] whose (present, string) value exceeds max, or null. */
export function firstTooLong(obj: Record<string, any>, limits: Array<[string, number]>): [string, number] | null {
  for (const [k, max] of limits) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.length > max) return [k, max];
  }
  return null;
}
