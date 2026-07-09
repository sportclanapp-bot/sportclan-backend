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

// AUDIT-5: cap user-supplied array lengths to block payload/DoS via huge arrays.
// Caps chosen to sit well above real UI limits (never break legit use).
export const ARRAY_LIMITS = {
  mentions: 20,
  participants: 50,
  forwardChats: 20,
  batchIds: 500,
  splitAmong: 50,
  sportIds: 30,
} as const;

export function tooManyItems(v: unknown, max: number): boolean {
  return Array.isArray(v) && v.length > max;
}

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

// SC-147: image URL fields must point at OUR storage, not an arbitrary external
// host (an external <Image> src is fetched on every viewer's device → IP/tracking
// leak). Allowlist = the R2 host(s) the upload endpoint actually returns (derived
// from the SAME env, so the upload → post round-trip always passes) + R2 public
// buckets (.r2.dev) + Google-OAuth avatars (.googleusercontent.com). https-only.
const IMAGE_HOST_SUFFIXES = ['.r2.dev', '.googleusercontent.com'];
function imageAllowlistHosts(): string[] {
  const hosts = new Set<string>();
  const acct = (process.env.R2_ACCOUNT_ID || '').toLowerCase();
  if (acct) hosts.add(`${acct}.r2.cloudflarestorage.com`);
  const pub = process.env.R2_PUBLIC_BASE_URL || '';
  if (pub) { try { hosts.add(new URL(pub).host.toLowerCase()); } catch { /* ignore */ } }
  return [...hosts];
}
export function isAllowedImageUrl(v: unknown): boolean {
  if (!isValidHttpUrl(v)) return false; // well-formed http(s) within length
  let host: string;
  try {
    const u = new URL(v as string);
    if (u.protocol !== 'https:') return false; // images must be https
    host = u.host.toLowerCase();
  } catch {
    return false;
  }
  if (imageAllowlistHosts().includes(host)) return true;
  return IMAGE_HOST_SUFFIXES.some((suf) => host.endsWith(suf));
}
/** First image-url field whose (present) value isn't an allowed storage URL, or null. */
export function firstDisallowedImageUrl(obj: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null || v === '') continue;
    if (!isAllowedImageUrl(v)) return k;
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
