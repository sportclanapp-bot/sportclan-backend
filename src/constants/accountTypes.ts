/**
 * Canonical account types (locked spec). Single source of truth shared by
 * registration (auth.controller) and profile-edit (users.controller) so the
 * two paths validate against the same whitelist. Kept in sync with the
 * frontend src/constants/accountTypes.ts list.
 */
export const VALID_ACCOUNT_TYPES = [
  'player', 'umpire', 'coach', 'commentator', 'organiser',
  'business', 'association', 'club', 'leagues', 'other',
] as const;

export type AccountType = (typeof VALID_ACCOUNT_TYPES)[number];

export function isValidAccountType(t: string): t is AccountType {
  return (VALID_ACCOUNT_TYPES as readonly string[]).includes(t);
}

/**
 * Normalize a raw account_types value into a clean, validated list:
 * lowercased, trimmed, de-duped, invalid entries dropped, 'player' first.
 * Falls back to ['player'] when nothing valid remains (e.g. empty or garbage
 * input at registration). Returns the canonical set the rest of the code can
 * trust.
 */
export function normalizeAccountTypes(input: unknown): AccountType[] {
  if (!Array.isArray(input)) return ['player'];
  const cleaned = Array.from(
    new Set(input.map((t) => String(t).toLowerCase().trim())),
  ).filter(isValidAccountType);
  if (cleaned.length === 0) return ['player'];
  // Keep 'player' first so it becomes the legacy primary column when present.
  return [
    ...cleaned.filter((t) => t === 'player'),
    ...cleaned.filter((t) => t !== 'player'),
  ];
}
