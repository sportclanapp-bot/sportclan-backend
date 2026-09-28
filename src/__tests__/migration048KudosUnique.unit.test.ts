/**
 * Migration 048 adds the kudos (from, to, match) unique rule only when the
 * triple has none. Its check used to accept ANY unique constraint or any index
 * whose definition contains "UNIQUE" — which the primary key's index does — so
 * a kudos table with a primary key and no rule on the triple was left without
 * one. Runs the migration verbatim on PGlite (in-process Postgres); PGlite needs
 * Node's ESM loader, so each scenario runs in a child `node` process.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

type Step = { rows?: any[]; error?: string };
const ROOT = path.join(__dirname, '..', '..');
const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '048_kudos_dedup_unique.sql'), 'utf8');
const RUNNER = `
import { PGlite } from '@electric-sql/pglite';
let s = ''; for await (const c of process.stdin) s += c;
const db = new PGlite(); const out = [];
for (const q of JSON.parse(s)) {
  try { const r = await db.exec(q); out.push({ rows: r.length ? r[r.length - 1].rows : [] }); }
  catch (e) { out.push({ error: e.message }); }
}
console.log('@@' + JSON.stringify(out));`;
function pg(steps: string[]): Step[] {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER], { cwd: ROOT, input: JSON.stringify(steps), encoding: 'utf8', timeout: 120000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`PGlite runner failed: ${r.stderr}`);
  return JSON.parse(line.slice(2));
}

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const M1 = '33333333-3333-4333-8333-333333333333';
const OTHERS = `
  CREATE TABLE follow_relationships (id serial, follower_id uuid, following_id uuid, UNIQUE (follower_id, following_id));
  CREATE TABLE team_members (id serial, team_id uuid, user_id uuid, UNIQUE (team_id, user_id));
  CREATE TABLE user_reviews (id serial, reviewer_id uuid, reviewed_id uuid, UNIQUE (reviewer_id, reviewed_id));`;
const kudos = (extra = '') => `
  CREATE TABLE kudos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user_id uuid NOT NULL, to_user_id uuid NOT NULL, match_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()${extra});`;
const give = `INSERT INTO kudos (from_user_id, to_user_id, match_id) VALUES ('${U1}','${U2}','${M1}')`;
/** Full unique indexes on exactly the triple, whatever their column order. */
const tripleRules = `
  SELECT count(*)::int AS n FROM pg_index i
  WHERE i.indrelid = 'kudos'::regclass AND i.indisunique AND i.indpred IS NULL AND i.indnatts = 3
    AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
         WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::smallint[]))
      = ARRAY['from_user_id','match_id','to_user_id']`;

function run(setup: string[]) {
  const out = pg([OTHERS, ...setup, MIG, tripleRules, give, give]);
  const n = setup.length;
  return { setupErrors: out.slice(0, n + 2).filter((s) => s.error).map((s) => s.error), rules: out[n + 2]!.rows![0].n as number, second: out[n + 4]! };
}

describe('migration 048 · the kudos (from, to, match) unique rule', () => {
  it('a kudos table with only a primary key gets the rule (the pkey is not a rule on the triple)', () => {
    const r = run([kudos()]);
    expect(r.setupErrors).toEqual([]);
    expect(r.rules).toBe(1);
    expect(r.second.error).toMatch(/duplicate key value violates unique constraint/);
  });

  it('a unique rule on other columns does not count', () => {
    const r = run([kudos(', UNIQUE (from_user_id, created_at)')]);
    expect(r.rules).toBe(1);
    expect(r.second.error).toMatch(/duplicate key/);
  });

  it('a partial unique index on the triple does not count', () => {
    const r = run([kudos(), `CREATE UNIQUE INDEX kudos_recent ON kudos (from_user_id, to_user_id, match_id) WHERE created_at > '2030-01-01'`]);
    expect(r.rules).toBe(1);
    expect(r.second.error).toMatch(/duplicate key/);
  });

  it('an existing rule on the triple, in any column order, is not duplicated', () => {
    const r = run([kudos(', UNIQUE (match_id, to_user_id, from_user_id)')]);
    expect(r.setupErrors).toEqual([]);
    expect(r.rules).toBe(1);
    expect(r.second.error).toMatch(/duplicate key/);
  });

  it('with no kudos table yet (a from-scratch rebuild) it skips cleanly; 078 creates the table', () => {
    const out = pg([OTHERS, MIG, `SELECT to_regclass('public.kudos') IS NULL AS absent`]);
    expect(out.filter((s) => s.error)).toEqual([]);
    expect(out[2]!.rows![0].absent).toBe(true);
  });
});
