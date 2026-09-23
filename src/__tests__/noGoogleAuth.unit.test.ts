/**
 * POST /auth/google is gone, and this is what stops it coming back.
 *
 * It had never worked in production: GOOGLE_CLIENT_ID was never set on Render,
 * so the endpoint answered 503 to every request from the day it shipped. No
 * account can have been created through it here, which is why removing it took
 * nothing away from anyone.
 *
 * `users.google_id` is deliberately KEPT — no schema change in the middle of a
 * test round — and the account scrub still nulls it. Dropping the column is
 * logged for the launch wipe.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the endpoint is gone', () => {
  it('no route serves /auth/google', () => {
    expect(code('routes/auth.routes.ts')).not.toMatch(/google/i);
  });

  it('no controller exports googleAuth', () => {
    expect(code('controllers/auth.controller.ts')).not.toContain('googleAuth');
  });

  it('nothing reads GOOGLE_CLIENT_ID any more', () => {
    for (const rel of ['controllers/auth.controller.ts', 'routes/auth.routes.ts']) {
      expect(code(rel)).not.toContain('GOOGLE_CLIENT_ID');
    }
  });

  it('and phone and email sign-in are untouched', () => {
    const routes = code('routes/auth.routes.ts');
    for (const r of ["'/send-otp'", "'/verify-otp'", "'/register'", "'/login'", "'/otp/login'"]) {
      expect(routes).toContain(r);
    }
  });
});

describe('the dependency went with it', () => {
  const pkg = JSON.parse(read('../package.json'));

  it('google-auth-library is no longer a direct dependency', () => {
    expect(pkg.dependencies['google-auth-library']).toBeUndefined();
  });

  it('and firebase-admin is gone too, since push moved to Expo', () => {
    // When Google sign-in was removed, firebase-admin stayed because push
    // used it. Push now goes through Expo's service (expo-server-sdk), so the
    // last Google server-side dependency went with it.
    expect(pkg.dependencies['firebase-admin']).toBeUndefined();
    expect(pkg.dependencies['expo-server-sdk']).toBeDefined();
  });
});

describe('what is deliberately left behind', () => {
  it('users.google_id stays, and the 30-day scrub still clears it', () => {
    // No schema change mid-test-round. Dropping it is logged for the wipe.
    expect(code('controllers/account.controller.ts')).toContain('google_id: null');
  });

  it('googleusercontent.com stays on the image host allow-list', () => {
    // An avatar already stored on that host would stop rendering if this went,
    // and an allow-list entry costs nothing. Also logged for the wipe.
    expect(code('utils/validation.ts')).toContain('.googleusercontent.com');
  });
});
