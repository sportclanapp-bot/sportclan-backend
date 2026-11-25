import { supabase } from './supabase';

/**
 * Fix list 25 Nov 2026, item 3 · "Available to play" after 30 days away.
 *
 * Someone who hasn't opened the app for 30 days (users.last_active_at) is switched
 * off by the sweep, which marks the row is_available_auto_off = true (migration
 * 169). Opening the app again switches them back on, only with that mark: a person
 * who switched it off themselves stays off, and any manual switch clears the mark.
 *
 * Every write here tolerates the column not being there yet (a server deployed
 * before 169 runs): nothing is switched off, and nothing else breaks.
 */
export const AUTO_OFF_AFTER_DAYS = 30;

/** "That column doesn't exist": PostgREST's schema cache (PGRST204) or Postgres (42703). */
export function isMissingColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST204' || code === '42703';
}

let warnedMissing = false;
function warnMissing(): void {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn('[availability] users.is_available_auto_off is missing (run migration 169); auto-off is idle'); // eslint-disable-line no-console
}

/** Switch off everyone away for 30 days. Idempotent: only rows still on are touched. */
export async function sweepAvailabilityAutoOff(now = Date.now()): Promise<{ switchedOff: number }> {
  const cutoff = new Date(now - AUTO_OFF_AFTER_DAYS * 86_400_000).toISOString();
  const { count, error } = await supabase
    .from('users')
    .update({ is_available: false, is_available_auto_off: true }, { count: 'exact' })
    .eq('is_available', true)
    .is('deleted_at', null)
    // Never seen at all (no last_active_at): counted from joining.
    .or(`last_active_at.lt.${cutoff},and(last_active_at.is.null,created_at.lt.${cutoff})`);
  if (error) {
    if (isMissingColumn(error)) { warnMissing(); return { switchedOff: 0 }; }
    throw new Error(error.message);
  }
  return { switchedOff: count ?? 0 };
}

/**
 * The app was opened: back on if the app switched it off. True when it did so.
 * Never throws and never blocks the caller's own answer on a failure (the next
 * open tries again).
 */
export async function restoreAvailabilityOnOpen(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('users')
      // last_active_at too, so a sweep running at this moment can't switch it off again.
      .update({ is_available: true, is_available_auto_off: false, last_active_at: new Date().toISOString() })
      .eq('id', userId)
      .eq('is_available_auto_off', true)
      .is('deleted_at', null)
      .select('id');
    if (error) {
      if (isMissingColumn(error)) warnMissing();
      else console.warn('[availability] restore failed', error.message); // eslint-disable-line no-console
      return false;
    }
    return (data ?? []).length > 0;
  } catch (e) {
    console.warn('[availability] restore failed', e instanceof Error ? e.message : e); // eslint-disable-line no-console
    return false;
  }
}

/** The row as the opener should see it: `is_available` back on when this open restored it. */
export async function withRestoredAvailability<T extends { is_available?: unknown }>(userId: string, row: T): Promise<T> {
  if (row.is_available !== false) return row;
  return (await restoreAvailabilityOnOpen(userId)) ? { ...row, is_available: true } : row;
}

/** Heartbeats are every minute: look for the mark at most once an hour per person (it takes 30 days to appear). */
const CHECK_EVERY_MS = 60 * 60 * 1000;
const lastCheck = new Map<string, number>();
export function shouldCheckRestore(userId: string, now = Date.now()): boolean {
  const last = lastCheck.get(userId) ?? 0;
  if (now - last < CHECK_EVERY_MS) return false;
  lastCheck.set(userId, now);
  if (lastCheck.size > 50_000) for (const [k, v] of lastCheck) if (now - v >= CHECK_EVERY_MS) lastCheck.delete(k);
  return true;
}
