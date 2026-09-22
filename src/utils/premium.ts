/**
 * SC-434 · there are no tiers any more. Every feature is free for everyone.
 *
 * This used to answer "is this user premium RIGHT NOW", and eight gates across
 * the product asked it before letting someone host a tournament, see their own
 * stats, post an image or send a gift.
 *
 * It is kept — rather than deleted along with its callers — for one round, and
 * returns true for everybody. That ordering is deliberate: flipping one function
 * opens all eight gates in a single reviewable change that can be reverted by
 * one line, and the call sites are then removed knowing the behaviour already
 * shipped. Deleting the function first would have meant eight simultaneous
 * behaviour changes and no way back without a revert of the whole thing.
 *
 * The `users.is_premium` and `premium_expires_at` columns stay on prod, untouched
 * and unread. 2,501 rows carry a complimentary expiry of 1 Oct 2026; nothing
 * consults it now, so nobody loses anything or hears about it when that date
 * passes.
 */
export function isPremiumActive(
  _user?: { is_premium?: boolean | null; premium_expires_at?: string | null } | null,
): boolean {
  return true;
}
