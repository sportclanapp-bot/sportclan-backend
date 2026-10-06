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
export const TOURNAMENT_FORMATS = ['knockout', 'league', 'round_robin', 'groups_knockout', 'swiss'] as const; // BUILD 4.15: swiss (chess, migration 116)

export function isValidTournamentFormat(format?: string | null): boolean {
  return !!format && (TOURNAMENT_FORMATS as readonly string[]).includes(format);
}

// ── Bounds (SC-38 / SC-39 + length caps) ─────────────────────────────────────
export const LIMITS = {
  tournamentMinTeams: 2,
  // Oct 2026 (Dipak): no app cap on a tournament's size — only what an int column holds.
  // SC-360: team_expenses.amount is NUMERIC(10,2) → the largest storable value
  // is 99999999.99. The old ceiling of 100_000_000 was ABOVE that, so the one
  // value the guard let through at its own boundary overflowed the column and
  // 500'd. The ceiling must be the column's limit, not a round number near it.
  expenseMaxAmount: 99_999_999.99,
  expenseTitleMax: 120,
  // SC-367: venue is free text on the match. It had NO cap at all — a 600-char
  // "venue" saved happily and then had to be rendered on cards built for a
  // ground name.
  venueMax: 120,
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
  forwardChats: 20,
  batchIds: 500,
  sportIds: 30,
} as const;

/**
 * Oct 2026 (Dipak) · no app-imposed caps on quantities. A count is a whole
 * number from `min` up to what an int column can hold (2,147,483,647) — the
 * storage's limit, not a product one.
 */
export const INT_MAX = 2_147_483_647;
export function isCount(v: unknown, min = 1): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= INT_MAX;
}

/**
 * N320 side finding 4: community_posts.post_type was stored as sent — a post
 * with post_type 'text' saved and the feed printed "text" on its card. The
 * types the app knows how to show; anything else is refused.
 */
export const POST_TYPES = [
  'general',
  'match_announcement',
  'achievement',
  'poll',
  'looking_for_team',
  'looking_for_player',
  'match_result',
] as const;
export type PostType = (typeof POST_TYPES)[number];
export function isPostType(v: unknown): v is PostType {
  return typeof v === 'string' && (POST_TYPES as readonly string[]).includes(v);
}

/**
 * A team's short name — the scorecard code (migration 110). Trimmed and
 * upper-cased; blank clears it (null). `undefined` = not sent, leave as is.
 * Over the limit, or not a string → an error message for a 400.
 */
export const SHORT_NAME_MAX = 3;
export function normalizeShortName(v: unknown): { value?: string | null; error?: string } {
  if (v === undefined) return {};
  if (v === null) return { value: null };
  if (typeof v !== 'string') return { error: 'Short name must be text.' };
  const t = v.trim().toUpperCase();
  if (t.length === 0) return { value: null };
  if ([...t].length > SHORT_NAME_MAX) return { error: `Short name must be ${SHORT_NAME_MAX} characters or fewer.` };
  return { value: t };
}

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

// ── Venue (SC-367/SC-368) ───────────────────────────────────────────────────
/**
 * The ONE normalisation rule for a free-text venue name, shared by the match
 * path (matches.venue) and the venue directory (POST /venues).
 *
 * SC-368: these were two implementations. The match path trimmed, rejected
 * empty-after-trim and capped at 120; the directory only trimmed — so it
 * accepted a 600-character "venue", and a whitespace-only name came back as a
 * cheerful `200 {"venue": null}` having created nothing. Same input, same
 * concept, two answers.
 */
export const VENUE_TOO_LONG = Symbol('venue-too-long');

export function normaliseVenue(raw: unknown): string | null | typeof VENUE_TOO_LONG {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim();
  if (clean.length === 0) return null;
  if (clean.length > LIMITS.venueMax) return VENUE_TOO_LONG;
  return clean;
}

/**
 * Phase 3 B10-F2: a query parameter as one string. `?q=a&q=b` arrives as an
 * array and `?q[x]=1` as an object; calling `.trim()` on either was a 500. A
 * repeated parameter keeps its first value; anything else that isn't text is
 * treated as not sent.
 */
export function queryText(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}
