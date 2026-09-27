/**
 * A deleted account's phone number (decided 28 Sep 2026).
 *
 * For 30 days after deletion the number stays on the dead row, so nobody can
 * sign back in and no code is sent to it (no SMS). After 30 days the number is
 * free: sign-up (or Change phone to it) works as a brand-new account with no
 * link to the old one. The hourly purge replaces the phone with a
 * `deleted:<id>` sentinel at that point; these helpers make the 30-day line
 * hold exactly even before the purge's next tick has run — an expired row that
 * still carries the number is released on the spot.
 */
import { supabase } from './supabase';
import { phoneVariants } from './phone';

/** How long a deleted account keeps its number. Also the purge's window. */
export const NUMBER_HOLD_MS = 30 * 86400000;

/**
 * The hold sign-up and Change phone apply. Always 30 days in production; a
 * local check may shorten it with DELETED_NUMBER_HOLD_SECONDS to exercise the
 * "after 30 days" path without editing data. The purge never uses this — it
 * keeps NUMBER_HOLD_MS, so no environment can scrub an account early.
 */
export function numberHoldMs(env: NodeJS.ProcessEnv = process.env): number {
  const s = Number(env.DELETED_NUMBER_HOLD_SECONDS);
  return env.NODE_ENV !== 'production' && Number.isFinite(s) && s > 0 ? s * 1000 : NUMBER_HOLD_MS;
}

/** When the number can be used again, or null if that moment has passed. */
export function holdUntil(deletedAt: string | null | undefined, now: number = Date.now()): string | null {
  if (!deletedAt) return null;
  const until = new Date(deletedAt).getTime() + numberHoldMs();
  return Number.isFinite(until) && until > now ? new Date(until).toISOString() : null;
}

/** The one refusal every path sends for a held number. */
export function deletedResponse(availableFrom: string | null) {
  return {
    error: 'This account has been deleted.',
    code: 'ACCOUNT_DELETED' as const,
    ...(availableFrom ? { available_from: availableFrom } : {}),
  };
}

export interface DeletedNumberState {
  /** Latest release moment among deleted rows still holding the number, or null. */
  heldUntil: string | null;
  /** Deleted rows past their 30 days that still carry the number (purge not run yet). */
  expiredIds: string[];
}

/** Deleted accounts that still carry this number, split into held and expired. */
export async function deletedNumberState(p: string, now: number = Date.now()): Promise<DeletedNumberState> {
  const { data } = await supabase
    .from('users')
    .select('id, deleted_at')
    .in('phone', phoneVariants(p))
    .not('deleted_at', 'is', null);
  let heldUntil: string | null = null;
  const expiredIds: string[] = [];
  for (const row of (data ?? []) as Array<{ id: string; deleted_at: string }>) {
    const h = holdUntil(row.deleted_at, now);
    if (h) { if (heldUntil === null || h > heldUntil) heldUntil = h; }
    else expiredIds.push(row.id);
  }
  return { heldUntil, expiredIds };
}

/**
 * Free the number from expired deleted rows — the same `deleted:<id>` sentinel
 * the purge and re-registration write — so it no longer matches anyone.
 * Returns false if any row couldn't be updated.
 */
export async function releaseNumber(expiredIds: string[]): Promise<boolean> {
  for (const id of expiredIds) {
    const { error } = await supabase.from('users').update({ phone: `deleted:${id}` }).eq('id', id).not('deleted_at', 'is', null);
    if (error) return false;
  }
  return true;
}
