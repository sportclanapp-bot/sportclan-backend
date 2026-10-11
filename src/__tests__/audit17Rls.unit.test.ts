/**
 * Audit #17 (11 Oct 2026, Dipak's decision 6): row-level security on every
 * table. Only 9 tables had it, and Supabase grants the public (anon) key
 * access to every table by default — with that key, users (with password
 * hashes), refresh tokens and messages were readable. Migration 148: RLS on
 * every table, no policy and no grant for anon/authenticated; service_role
 * (the backend) keeps everything. Run on a real Postgres (PGlite).
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
const RUNNER = `
import { PGlite } from '@electric-sql/pglite';
let s = ''; for await (const c of process.stdin) s += c;
const db = new PGlite(); const out = [];
for (const q of JSON.parse(s)) {
  try { const r = await db.exec(q); out.push({ rows: r.length ? r[r.length - 1].rows : [] }); }
  catch (e) { out.push({ error: e.message }); }
}
console.log('@@' + JSON.stringify(out));`;
function pg(steps: string[]) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER], { cwd: ROOT, input: JSON.stringify(steps), encoding: 'utf8', timeout: 120000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`PGlite runner failed: ${r.stderr}`);
  return JSON.parse(line.slice(2)) as Array<{ rows?: any[]; error?: string }>;
}
const MIGDIR = path.join(ROOT, 'supabase', 'migrations');
const MIG = fs.readFileSync(path.join(MIGDIR, '148_rls_everywhere.sql'), 'utf8');

describe('audit #17: the public key reads and writes nothing', () => {
  const out = pg([
    `CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;`,
    `CREATE TABLE users (id int primary key, password_hash text); INSERT INTO users VALUES (1, 'hash');`,
    `CREATE TABLE refresh_tokens (id int primary key, token_hash text); INSERT INTO refresh_tokens VALUES (1, 'h');`,
    `CREATE FUNCTION add_coins(n int) RETURNS int LANGUAGE sql SECURITY DEFINER AS 'select n';`,
    // what Supabase grants by default
    `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;`,
    `SET ROLE anon; SELECT count(*)::int AS n FROM users;`,
    `RESET ROLE;`,
    MIG,
    MIG,
    `SET ROLE anon; SELECT count(*)::int AS n FROM users;`,
    `RESET ROLE; SET ROLE anon; INSERT INTO refresh_tokens VALUES (2, 'x');`,
    `RESET ROLE; SET ROLE anon; SELECT add_coins(5) AS n;`,
    `RESET ROLE; SET ROLE service_role; SELECT count(*)::int AS n FROM users;`,
    `RESET ROLE; SELECT count(*) FILTER (WHERE rowsecurity)::int AS on, count(*)::int AS all FROM pg_tables WHERE schemaname = 'public';`,
    `RESET ROLE; GRANT SELECT ON users TO anon; SET ROLE anon; SELECT count(*)::int AS n FROM users;`,
  ]);
  it('before: the public key could read users (the hole)', () => {
    expect(out[5].rows?.[0]?.n).toBe(1);
  });
  it('the migration runs cleanly, twice', () => {
    expect([out[7].error, out[8].error]).toEqual([undefined, undefined]);
  });
  it('after: no read, no write, no function call for the public key', () => {
    expect(out[9].error).toMatch(/permission denied/);
    expect(out[10].error).toMatch(/permission denied/);
    expect(out[11].error).toMatch(/permission denied/);
  });
  it('the server (service_role) keeps everything', () => {
    expect(out[12].rows?.[0]?.n).toBe(1);
  });
  it('every table has RLS on', () => {
    expect(out[13].rows?.[0]).toEqual({ on: 2, all: 2 });
  });
  it('even a grant put back by mistake shows no rows (RLS, no policy)', () => {
    expect(out[14].rows?.[0]?.n).toBe(0);
  });
});

describe('audit #17: a table added later keeps RLS', () => {
  it('every migration after 148 that creates a table enables RLS on it', () => {
    const later = fs.readdirSync(MIGDIR).filter((f) => /^\d+_/.test(f) && Number(f.split('_')[0]) > 148);
    for (const f of later) {
      const s = fs.readFileSync(path.join(MIGDIR, f), 'utf8');
      for (const m of s.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_]+)/gi)) {
        expect(s).toMatch(new RegExp(`ALTER TABLE (?:public\\.)?${m[1]} ENABLE ROW LEVEL SECURITY`, 'i'));
      }
    }
  });
});
