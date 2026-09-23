/**
 * The API must report its crashes, and must not lose the hook to a refactor.
 *
 * Before this, a 500 left one line in Render's logs and an uncaught throw took
 * the process down with no record of why. `SENTRY_DSN` sat in `.env.example`
 * and nothing read it.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('it is initialised before anything can throw', () => {
  const index = code('index.ts');

  it('initSentry runs above the route imports', () => {
    // An error while WIRING the app is precisely the one worth reporting, and
    // a reporter initialised further down would miss it.
    expect(index.indexOf('initSentry()')).toBeLessThan(index.indexOf("from './routes/auth.routes'"));
  });

  it('process-level handlers are installed too', () => {
    expect(index).toContain('installProcessHandlers()');
    const s = code('utils/sentry.ts');
    expect(s).toContain("process.on('uncaughtException'");
    expect(s).toContain("process.on('unhandledRejection'");
  });

  it('and they flush before the process exits', () => {
    // The whole point is to get the event out before the process dies.
    expect(code('utils/sentry.ts')).toMatch(/Sentry\.flush\(\d+\)[\s\S]{0,60}process\.exit\(1\)/);
  });
});

describe('the Express hook sees the REAL error', () => {
  const index = code('index.ts');

  it('sentryErrorHandler is mounted before globalErrorHandler', () => {
    // globalErrorHandler sanitises the throw into a clean 500. A reporter
    // after it would capture the sanitised version — the one with the detail
    // removed.
    const s = index.indexOf('app.use(sentryErrorHandler)');
    const g = index.indexOf('app.use(globalErrorHandler)');
    expect(s).toBeGreaterThan(-1);
    expect(g).toBeGreaterThan(-1);
    expect(s).toBeLessThan(g);
  });

  it('and never changes the response', () => {
    const m = code('middleware/sentryError.ts');
    expect(m).toContain('next(err)');
    expect(m).not.toMatch(/res\.(status|json|send)\(/);
  });

  it('a failing reporter does not become the error', () => {
    expect(code('middleware/sentryError.ts')).toMatch(/try \{[\s\S]*?\} catch \{/);
  });
});

describe('what it refuses to send', () => {
  const s = code('utils/sentry.ts');

  it('strips request bodies, headers and cookies', () => {
    // The API handles phone numbers, emails and tokens. The obvious next step
    // — adding the Express request integration for richer context — is exactly
    // what would start shipping those to a third party.
    for (const k of ['cookies', 'headers', 'data']) {
      expect(s).toContain(`delete event.request?.${k}`);
    }
  });

  it('logs only the path, never the query string', () => {
    const m = code('middleware/sentryError.ts');
    expect(m).toContain('req.path');
    expect(m).not.toContain('req.originalUrl');
    expect(m).not.toContain('req.query');
  });

  it('spends nothing on performance traces', () => {
    expect(s).toContain('tracesSampleRate: 0');
  });
});

describe('an unconfigured deploy still boots', () => {
  const s = code('utils/sentry.ts');

  it('no DSN means every function is a no-op', () => {
    // The error reporter must never be the reason a deploy fails — it is the
    // one component whose failure you cannot see.
    expect(s).toMatch(/if \(!dsn\) \{[\s\S]*?return;/);
    expect(s).toMatch(/if \(!enabled\) return;/);
  });

  it('and says so, rather than failing silently', () => {
    expect(s).toContain('error reporting is OFF');
  });

  it('tags the release with the deploy Render is running', () => {
    expect(s).toContain('process.env.RENDER_GIT_COMMIT');
  });
});

describe('no secret in the repo', () => {
  it('the DSN is read from the environment, never hard-coded', () => {
    expect(code('utils/sentry.ts')).toContain('process.env.SENTRY_DSN');
    expect(read('../.env.example')).not.toMatch(/SENTRY_DSN=\S/);
  });
});
