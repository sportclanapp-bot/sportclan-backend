/**
 * Profile rules shared by sign-up (auth.register) and Edit profile
 * (PATCH /users/me). Phase 3 B01-F3: sign-up checked none of them, so `admin`,
 * a 300-character username or a blank name got through at registration while
 * Edit profile refused them.
 */
import { LIMITS, firstInvalidUrl, firstDisallowedImageUrl } from './validation';

/**
 * SC-365: usernames nobody may take.
 *
 * Found by testing: there was no list at all, so a normal user could become
 * @admin or @support and message people from what reads like an official
 * account. That's an impersonation vector, not a naming nicety.
 *
 * Matched case-insensitively against the whole username (not a substring — we
 * don't want to block a legitimate "adminder" or "supporter").
 */
export const RESERVED_USERNAMES = new Set([
  'admin', 'admins', 'administrator', 'root', 'superuser', 'sysadmin',
  'support', 'help', 'helpdesk', 'contact', 'info', 'team', 'staff',
  'sportclan', 'sportclanapp', 'official', 'verified', 'moderator', 'mod',
  'security', 'billing', 'payments', 'noreply', 'no-reply', 'system',
  'api', 'www', 'about', 'settings', 'login', 'signup', 'register', 'me',
]);

/** RFC-shaped enough to catch real typos without rejecting valid addresses. */
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

/**
 * The genders a profile may store — users_gender_check (migration 111, applied
 * 29 Sep 2026). "Prefer not to say" is its own value so Edit profile can show
 * it as chosen; null still means "never answered".
 */
export const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'] as const;
export const GENDER_ERROR = 'gender must be male, female, other, or prefer_not_to_say';

export interface RuleProblem { status: number; error: string; code?: string }

/** Why a date of birth is refused, or null (the rule updateMe applies, SC-248). */
export function dobProblem(dob: unknown): string | null {
  if (dob == null || dob === '') return null;
  const d = new Date(dob as string);
  if (isNaN(d.getTime())) return 'Date of birth is not a valid date';
  // N-RWG4-13 (launch test plan): by calendar DATE, as the app's picker offers it (today,
  // back to the same day 120 years ago). Measuring 120 × 365.25 days from this instant
  // refused the picker's own earliest date for most of the day. India's date, with a
  // day's slack either side for a phone in another time zone.
  const ymd = typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dob) ? dob.slice(0, 10) : d.toISOString().slice(0, 10);
  const today = indiaYmd(new Date());
  if (ymd > shiftYmd(today, 1)) return 'Date of birth can\u2019t be in the future';
  const floor = `${String(Number(today.slice(0, 4)) - 120).padStart(4, '0')}${today.slice(4)}`;
  if (ymd < shiftYmd(floor, -1)) return 'Please enter a valid date of birth';
  return null;
}

/** Today's date in India, YYYY-MM-DD. */
function indiaYmd(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
/** A YYYY-MM-DD date moved by whole days. */
function shiftYmd(ymd: string, days: number): string {
  const t = Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The sign-up fields, checked as Edit profile checks them. Returns the first
 * problem, or null. Doesn't touch the database (uniqueness is the caller's).
 */
/**
 * F038 (launch test plan): the local area ("Kothrud") — optional text, up to
 * LIMITS.localAreaMax. Null when fine (or absent); else why not.
 */
export function localAreaProblem(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return 'Local area must be text.';
  if (v.trim().length > LIMITS.localAreaMax) return `Local area must be ${LIMITS.localAreaMax} characters or fewer`;
  return null;
}

/** F038: a local area as stored — trimmed, an empty one is none. */
export function cleanLocalArea(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function signupProfileProblem(f: {
  name?: unknown; username?: unknown; email?: unknown; dob?: unknown; bio?: unknown;
  link?: unknown; profile_picture_url?: unknown; local_area?: unknown;
}): RuleProblem | null {
  if (typeof f.name !== 'string' || f.name.trim().length === 0) {
    return { status: 400, error: 'Name can\u2019t be empty.', code: 'INVALID_NAME' };
  }
  if (f.name.trim().length > LIMITS.teamNameMax) {
    return { status: 400, error: `Name must be ${LIMITS.teamNameMax} characters or fewer` };
  }
  if (typeof f.username !== 'string' || !USERNAME_RE.test(f.username.trim())) {
    return { status: 400, error: 'Username must be 3\u201330 characters, using only letters, numbers, and underscores.', code: 'INVALID_USERNAME' };
  }
  if (RESERVED_USERNAMES.has(f.username.trim().toLowerCase())) {
    return { status: 400, error: 'That username is reserved. Please choose another.', code: 'USERNAME_RESERVED' };
  }
  if (f.email != null && f.email !== '' && (typeof f.email !== 'string' || !EMAIL_RE.test(f.email.trim().toLowerCase()))) {
    return { status: 400, error: 'Enter a valid email address.', code: 'INVALID_EMAIL' };
  }
  const dob = dobProblem(f.dob);
  if (dob) return { status: 400, error: dob };
  if (f.bio != null && (typeof f.bio !== 'string' || f.bio.length > LIMITS.bioMax)) {
    return { status: 400, error: `Bio must be ${LIMITS.bioMax} characters or fewer` };
  }
  const area = localAreaProblem(f.local_area);
  if (area) return { status: 400, error: area, code: 'INVALID_LOCAL_AREA' };
  const badLink = firstInvalidUrl(f as Record<string, unknown>, ['link']);
  if (badLink) return { status: 400, error: `${badLink} must be a valid URL` };
  if (firstDisallowedImageUrl(f as Record<string, unknown>, ['profile_picture_url'])) {
    return { status: 400, error: 'profile_picture_url must be an uploaded image URL', code: 'INVALID_IMAGE_URL' };
  }
  return null;
}
