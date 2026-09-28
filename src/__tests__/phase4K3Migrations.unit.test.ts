/**
 * Phase 4 · K3 — schema migrations proven on a real Postgres (PGlite, in-process).
 * PGlite needs Node's ESM loader, which Jest's sandbox doesn't provide, so each
 * case runs an inline ES module in a child process and prints JSON.
 */
import { spawnSync } from 'child_process';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
function pg(body: string): any {
  const src = `
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const mig = (f) => fs.readFileSync('supabase/migrations/' + f, 'utf8');
const db = new PGlite();
const out = {};
try {
${body}
} catch (e) { out.error = String(e && e.message || e); }
console.log(JSON.stringify(out));
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const line = (r.stdout || '').trim().split('\n').pop() || '';
  try { return JSON.parse(line); } catch { throw new Error(`no JSON from child: ${r.stdout}\n${r.stderr}`); }
}

/** The tables 048/078 reference that earlier migrations create — bare stubs. */
const STUBS = `
await db.exec(\`
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE cities (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE sports (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE follow_relationships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), follower_id uuid, following_id uuid, UNIQUE (follower_id, following_id));
CREATE TABLE team_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid, user_id uuid, UNIQUE (team_id, user_id));
CREATE TABLE user_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reviewer_id uuid, reviewed_id uuid, UNIQUE (reviewer_id, reviewed_id));
\`);`;

describe('SC-368 · a from-scratch rebuild creates the drifted tables', () => {
  it('K3-17 (439296c): 048 no longer aborts a clean run (kudos not created yet), and 078 creates all five tables', () => {
    const r = pg(`${STUBS}
      await db.exec(mig('048_kudos_dedup_unique.sql'));
      out.after048 = 'ok';
      await db.exec(mig('078_codify_drifted_tables.sql'));
      const t = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('venues','kudos','seasons','season_medals','match_ratings') ORDER BY 1");
      out.tables = t.rows.map((x) => x.table_name);
      const n = await db.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='venues' AND column_name IN ('use_count','created_at','name') ORDER BY 1");
      out.venueNull = Object.fromEntries(n.rows.map((x) => [x.column_name, x.is_nullable]));
      await db.exec(mig('078_codify_drifted_tables.sql'));
      out.rerun = 'ok';`);
    expect(r.error).toBeUndefined();
    expect(r.after048).toBe('ok');
    expect(r.tables).toEqual(['kudos', 'match_ratings', 'season_medals', 'seasons', 'venues']);
    // Prod shape, reproduced: use_count / created_at nullable, name NOT NULL.
    expect(r.venueNull).toEqual({ created_at: 'YES', name: 'NO', use_count: 'YES' });
    expect(r.rerun).toBe('ok'); // idempotent: a no-op on prod
  });

  it('K3-17 (439296c): kudos gets its UNIQUE (from, to, match) inline', () => {
    const r = pg(`${STUBS}
      await db.exec(mig('078_codify_drifted_tables.sql'));
      const u = (await db.query("SELECT gen_random_uuid() AS a, gen_random_uuid() AS b, gen_random_uuid() AS m")).rows[0];
      await db.exec(\`INSERT INTO users (id) VALUES ('\${u.a}'), ('\${u.b}'); INSERT INTO matches (id) VALUES ('\${u.m}');\`);
      await db.exec(\`INSERT INTO kudos (from_user_id, to_user_id, match_id) VALUES ('\${u.a}', '\${u.b}', '\${u.m}')\`);
      try { await db.exec(\`INSERT INTO kudos (from_user_id, to_user_id, match_id) VALUES ('\${u.a}', '\${u.b}', '\${u.m}')\`); out.dupe = 'inserted'; }
      catch (e) { out.dupe = 'refused'; }`);
    expect(r.error).toBeUndefined();
    expect(r.dupe).toBe('refused');
  });
});
