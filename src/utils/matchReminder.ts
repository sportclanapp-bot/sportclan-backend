/**
 * F007 (launch test plan): when a match reminder goes, and its words. Used by
 * the reminder sweep (features.controller) and the app-open check
 * (users.controller runSmartNotifications).
 */
import { plural } from './plural';

/** F007: how long before kick-off the reminder goes. */
export const REMINDER_LEAD_MS = 15 * 60 * 1000;
/** F007: how often the sweep runs in process (it was 5 minutes). */
export const REMINDER_TICK_MS = 60 * 1000;
/** F007: a reminder missed while the server slept is still sent up to this long after the start, if the match hasn't started. */
export const REMINDER_CATCHUP_MS = 15 * 60 * 1000;

/** F007: the reminder's words — the minutes left as they are, or that it was due (a catch-up). */
export function matchReminderBody(names: string | null, scheduledAt: string, now: Date, kickoff: string | null): string {
  const who = names ?? 'Your match';
  const left = Math.round((new Date(scheduledAt).getTime() - now.getTime()) / 60000);
  if (left <= 0) return `⏰ ${who} was due to start${kickoff ? ` at ${kickoff}` : ''} and hasn’t started yet.`;
  return `⏰ ${who} starts ${kickoff ? `at ${kickoff} ` : ''}in ${plural(left, 'minute')}!`;
}
