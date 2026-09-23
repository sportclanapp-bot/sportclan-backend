/**
 * Crash reporting for the API.
 *
 * Until now the backend had none. `SENTRY_DSN` sat in `.env.example` and nothing
 * read it, so a 500 left one line in Render's logs and an uncaught throw took
 * the process down with no record of why beyond whatever scrolled past.
 *
 * Three rules this file exists to hold:
 *
 * 1. **Guarded on the DSN.** With `SENTRY_DSN` unset, every function here is a
 *    no-op and the server starts exactly as before. An unconfigured deploy must
 *    never fail to boot because of its error reporter — that is the one
 *    component whose failure you cannot see.
 *
 * 2. **Initialised before anything can throw.** `init()` is called at the very
 *    top of index.ts, before routes are built, because an error while wiring
 *    the app is precisely the error you most want reported.
 *
 * 3. **The release is the deploy.** Render exposes `RENDER_GIT_COMMIT`, which is
 *    the same SHA `/health` reports, so an event in Sentry names the build that
 *    produced it without anyone maintaining a version string.
 *
 * NOTE ON REGION: this org lives in Sentry's EU region
 * (`ingest.de.sentry.io`). The DSN carries that, so the SDK needs no extra
 * configuration — but sentry-cli does, which is why the app's
 * `sentry.properties` sets the region URL explicitly.
 */
import * as Sentry from '@sentry/node';

let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

/** Call once, first thing in index.ts. Safe to call with no DSN. */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // eslint-disable-next-line no-console
    console.warn('[sentry] SENTRY_DSN not set — error reporting is OFF');
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || undefined,
    // Errors only. Performance tracing bills against a separate quota and we
    // want the free tier spent on crashes, not spans.
    tracesSampleRate: 0,
    // The API handles phone numbers, emails and tokens. This SDK version does
    // not attach request bodies or headers unless an integration is added that
    // does, and none is — but the rule is worth stating, because the obvious
    // next step (adding the Express request integration for richer context) is
    // exactly what would start shipping phone numbers to a third party.
    beforeSend(event) {
      delete event.request?.cookies;
      delete event.request?.headers;
      delete event.request?.data;
      return event;
    },
  });
  enabled = true;
  // eslint-disable-next-line no-console
  console.log(`[sentry] error reporting ON (release ${process.env.RENDER_GIT_COMMIT || 'unknown'})`);
}

/**
 * Report an error that has already been handled.
 *
 * Used by the Express backstop, which must still return a sanitised 500 to the
 * caller — so the reporting cannot be left to an SDK handler that swallows the
 * response.
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/**
 * Report and then re-raise a process-level fault.
 *
 * An uncaught exception or an unhandled rejection is the class that kills the
 * process, and the whole point is to get the event OUT before that happens —
 * hence the flush with a short timeout. Longer would delay the restart; shorter
 * loses the event on a slow network.
 */
export function installProcessHandlers(): void {
  if (!enabled) return;
  const bail = (kind: string) => (err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`[sentry] ${kind}`, err);
    Sentry.captureException(err, { tags: { kind } });
    void Sentry.flush(2000).then(() => process.exit(1));
  };
  process.on('uncaughtException', bail('uncaughtException'));
  // A rejected promise nobody awaited does not kill the process on its own in
  // every Node version, but it means state is now unknowable. Report and stop
  // rather than continue on a server that has silently lost a write.
  process.on('unhandledRejection', bail('unhandledRejection'));
}
