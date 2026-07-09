// SC-144: single source of truth for "is this user premium RIGHT NOW". Gating on
// the raw `is_premium` flag left a stale-premium window: the flag is only flipped
// to false by the hourly sweep / the /users/me lazy check, so an expired user kept
// premium features for up to ~1h. This evaluates expiry LIVE (mirrors the
// create-tournament check exactly). The sweep + lazy check remain as flag cleanup.
export function isPremiumActive(
  user: { is_premium?: boolean | null; premium_expires_at?: string | null } | null | undefined,
): boolean {
  if (!user?.is_premium) return false;
  if (!user.premium_expires_at) return true; // null expiry = lifetime / legacy grant
  return new Date(user.premium_expires_at).getTime() > Date.now();
}
