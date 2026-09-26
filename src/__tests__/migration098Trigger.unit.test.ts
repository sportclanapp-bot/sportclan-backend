/**
 * Migration 098 · the test-content trigger, proven on a REAL Postgres.
 *
 * The first draft read NEW.author_id / NEW.created_by / NEW.tournament_id
 * directly. PL/pgSQL resolves NEW.<field> against the table the trigger fired
 * on, so on teams (no author_id) and community_posts (no created_by) every
 * INSERT would have failed with 'record "new" has no field …' — caught in
 * review before it ran on production.
 *
 * scripts/prove-098-trigger.mjs runs the migration's blocks 2–3 and CHECK-098's
 * blocks 3–4 VERBATIM on PGlite (in-process Postgres), inserts into all six
 * tables as a test and a real account, and a match into a flagged tournament.
 * It runs as a child process because PGlite needs Node's ESM loader, which
 * Jest's sandbox doesn't provide.
 */
import { spawnSync } from 'child_process';
import path from 'path';

describe('migration 098 trigger on a real Postgres', () => {
  it('every insert succeeds on all six tables and flags correctly; CHECK-098 blocks 3–4 pass', () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'prove-098-trigger.mjs')], {
      encoding: 'utf8',
      timeout: 120000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out).not.toMatch(/^FAIL /m);
    expect((out.match(/^PASS /gm) ?? []).length).toBe(17);
    expect(r.status).toBe(0);
  });
});
