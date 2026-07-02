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
} as const;
