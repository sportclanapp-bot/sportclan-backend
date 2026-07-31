// Phone validation — mirrors the frontend `src/utils/phone.ts` so a direct API
// call (bypassing the app's client-side check) is validated the same way.
// Canonical Indian mobile: `+91XXXXXXXXXX` (10 digits, starting 6-9). Accepts
// the same lenient inputs the client normalizes (with/without +91, spaces,
// dashes) and rejects junk ("12", letters, too-short/long).

/** True iff `input` is (or normalizes to) a valid 10-digit Indian mobile. */
export function isValidIndianPhone(input: unknown): boolean {
  if (!input || typeof input !== 'string') return false;
  const stripped = input.replace(/[^\d+]/g, '');
  let digits = stripped.replace(/^\+/, '');
  if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  if (digits.length !== 10) return false;
  return /^[6-9]/.test(digits);
}

/**
 * SC-386 · the ONE canonical form: E.164 `+91XXXXXXXXXX`.
 *
 * isValidIndianPhone already accepted `+919876543210`, `919876543210`,
 * `9876543210` and spaced/dashed variants as the same number — but nothing
 * converted between them, and the duplicate check was a raw string compare. So
 * one human could hold TWO accounts on one number, one in each form.
 *
 * Returns null for anything that isn't a canonicalisable Indian mobile. Callers
 * must treat null as "leave it alone", never as "store null" — overwriting a
 * legacy value would lock that account out.
 */
export function canonicalisePhone(input: unknown): string | null {
  if (!input || typeof input !== 'string') return null;
  let digits = input.replace(/[^\d]/g, '').replace(/^0+/, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length !== 10 || !/^[6-9]/.test(digits)) return null;
  return `+91${digits}`;
}

/**
 * Every stored form that could represent this number, canonical first.
 *
 * Used for LOOKUPS (login, OTP, duplicate checks) so the code works whether or
 * not migration 083 has run yet. Before the migration a legacy row is still
 * found; after it, the canonical form matches on the first try. Being
 * permissive on read is deliberate — a lookup that only accepted the canonical
 * form would lock out every account still stored the old way during the deploy
 * window.
 */
export function phoneVariants(input: unknown): string[] {
  const raw = typeof input === 'string' ? input.trim().replace(/\s+/g, '') : '';
  const canon = canonicalisePhone(input);
  if (!canon) return raw ? [raw] : [];
  const ten = canon.slice(3);
  return Array.from(new Set([canon, ten, `91${ten}`, `0${ten}`, raw].filter(Boolean)));
}
