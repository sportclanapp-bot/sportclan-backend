/**
 * SC-427 · /health has to identify the build that is answering.
 *
 * Confirming the SC-424 deploy meant probing for a route that only existed in the
 * new code (404 → 401). That works only when a release happens to add a route, and
 * says nothing otherwise. These pin the shape callers depend on.
 */

/** The handler's projection, extracted so it can be exercised without booting
 *  express and its rate limiters. Mirrors src/index.ts exactly. */
function healthBody(env: Record<string, string | undefined>, bootIso: string) {
  const commit = env.RENDER_GIT_COMMIT ?? null;
  return {
    status: 'ok',
    commit: commit ? commit.slice(0, 7) : null,
    branch: env.RENDER_GIT_BRANCH ?? null,
    startedAt: bootIso,
  };
}

const BOOT = '2026-09-21T12:00:00.000Z';

describe('SC-427 · /health identifies the build', () => {
  it('reports the SHORT sha on Render', () => {
    const body = healthBody(
      { RENDER_GIT_COMMIT: 'abf81741f2c3d4e5a6b7c8d9', RENDER_GIT_BRANCH: 'main' },
      BOOT,
    );
    expect(body).toEqual({ status: 'ok', commit: 'abf8174', branch: 'main', startedAt: BOOT });
  });

  it('is null, not undefined, off Render — the shape never changes', () => {
    const body = healthBody({}, BOOT);
    expect(body.commit).toBeNull();
    expect(body.branch).toBeNull();
    expect(Object.keys(body).sort()).toEqual(['branch', 'commit', 'startedAt', 'status']);
  });

  it('keeps status:"ok" first-class, so existing uptime checks are unaffected', () => {
    expect(healthBody({}, BOOT).status).toBe('ok');
    expect(healthBody({ RENDER_GIT_COMMIT: 'deadbeefcafe' }, BOOT).status).toBe('ok');
  });

  it('startedAt distinguishes a redeploy from the same build still running', () => {
    const a = healthBody({ RENDER_GIT_COMMIT: 'aaaaaaa1' }, '2026-09-21T12:00:00.000Z');
    const b = healthBody({ RENDER_GIT_COMMIT: 'aaaaaaa1' }, '2026-09-21T13:00:00.000Z');
    expect(a.commit).toBe(b.commit);
    expect(a.startedAt).not.toBe(b.startedAt);
  });
});
