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
