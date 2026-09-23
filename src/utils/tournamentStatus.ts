/**
 * F-52 · a tournament is LIVE when it starts, not when its fixtures are drawn.
 *
 * Generating the draw flipped the tournament straight to `live`. A cup starting
 * on 29 Sep 2026 — a week away, not a ball bowled — read LIVE the moment the
 * organiser pressed Generate, and it had read UPCOMING correctly right up to
 * that step. Everything downstream inherits it: the hub's Live section, the
 * "what's on now" lists, and every organiser who has to explain to their teams
 * why the app says their tournament is already under way.
 *
 * Making the draw is preparation. It is the thing organisers do in advance, on
 * purpose, so that nothing has to be decided on the day.
 */

/** The four statuses the column's CHECK constraint allows (migration 004). */
export type TournamentStatus = 'upcoming' | 'live' | 'completed' | 'cancelled';

/**
 * Today in ISO date form (YYYY-MM-DD), matching `tournaments.start_date`, which
 * is a DATE and therefore has no timezone of its own.
 */
export function ymd(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * What the status should be once fixtures exist.
 *
 * A tournament with NO start date goes live: there is nothing to wait for, and
 * an organiser who drew the fixtures without setting a date is starting now.
 * That is also the pre-migration-062 shape, so old tournaments behave as they
 * always did.
 */
export function statusAfterFixtures(startDate: string | null | undefined, now: Date = new Date()): TournamentStatus {
  if (!startDate) return 'live';
  return startDate.slice(0, 10) <= ymd(now) ? 'live' : 'upcoming';
}

/**
 * Should the hourly sweep flip this one to live?
 *
 * Only a tournament that is still `upcoming`, whose start date has arrived, and
 * which actually has fixtures — a cup whose draw was never made is not "live",
 * it is unstarted, and flipping it would replace one wrong badge with another.
 */
export function shouldGoLive(
  t: { status: string; start_date: string | null | undefined },
  hasFixtures: boolean,
  now: Date = new Date(),
): boolean {
  if (t.status !== 'upcoming' || !hasFixtures) return false;
  return statusAfterFixtures(t.start_date, now) === 'live';
}
