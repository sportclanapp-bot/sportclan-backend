/**
 * Audit #99 (11 Oct 2026): work started without waiting for it (a notice, a
 * coin award, a fan-out) must never become an unhandled rejection — the crash
 * handler (utils/sentry) stops the whole server on one. Run it here instead:
 * a failure is logged and the request that started it is unaffected.
 */
export function inBackground(work: Promise<unknown> | unknown, label: string): void {
  Promise.resolve(work).catch((e) => {
    console.error(`[background] ${label} failed`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
  });
}
