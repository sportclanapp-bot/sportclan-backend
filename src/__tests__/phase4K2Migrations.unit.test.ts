/**
 * Phase 4 · K2 — the staged SQL migrations of the K2 backend fixes, run
 * VERBATIM from supabase/migrations on a real Postgres (PGlite, in-process).
 * PGlite needs Node's ESM loader, which Jest's sandbox doesn't provide, so each
 * scenario runs in a child `node --input-type=module` process: the steps go in
 * on stdin, one result per step comes back as JSON.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

type Step = { rows?: any[]; error?: string };
const ROOT = path.join(__dirname, '..', '..');
const mig = (f: string) => fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', f), 'utf8');
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
const ok = (s: Step[]) => s.filter((x) => x.error).map((x) => x.error);

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const M1 = '33333333-3333-4333-8333-333333333333';
const K1 = '44444444-4444-4444-8444-444444444444';
const K2 = '55555555-5555-4555-8555-555555555555';

describe('K2-9 / K2-19 / K2-22 · record_match_event (migrations 049 → 055 → 056)', () => {
  const SCHEMA = `
    CREATE TABLE match_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL, event_type text NOT NULL,
      period int, clock_seconds int, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now());`;
  const rec = (payload: string, key: string | null = null) =>
    `SELECT record_match_event('${M1}','${U1}','ball',1,null,'${payload}'::jsonb,3,${key ? `'${key}'` : 'NULL'}) AS r`;
  const count = `SELECT count(*)::int AS n FROM match_events`;
  let out: Step[];
  beforeAll(() => {
    out = pg([
      SCHEMA, mig('049_record_match_event_atomic.sql'), mig('055_match_event_idempotency_key.sql'), mig('056_record_match_event_was_new.sql'),
      rec('{"runs":1}'), rec('{"runs":1}'), count, // 4,5,6: no-key double-tap
      rec('{"runs":4}'), count, // 7,8: a distinct ball
      rec('{"runs":2}', K1), `UPDATE match_events SET created_at = now() - interval '1 hour' WHERE client_key = '${K1}'`, rec('{"runs":2}', K1), count, // 9..12: slow keyed retry
      rec('{"runs":2}', K2), count, // 13,14: a new tap (new key), identical payload
    ]);
  });
  it('K2-9/K2-19/K2-22: the migration chain applies cleanly', () => {
    expect(ok(out.slice(0, 4))).toEqual([]);
  });
  it('K2-9 (dee84f7): an identical no-key submit inside the window is ONE event', () => {
    expect(out[4].rows![0].r.was_new).toBe(true);
    expect(out[5].rows![0].r.was_new).toBe(false);
    expect(out[5].rows![0].r.event.id).toBe(out[4].rows![0].r.event.id);
    expect(out[6].rows![0].n).toBe(1);
  });
  it('K2-9 (dee84f7): a genuinely different event still inserts', () => {
    expect(out[7].rows![0].r.was_new).toBe(true);
    expect(out[8].rows![0].n).toBe(2);
  });
  it('K2-19 (a3ddf8b): a retry with the same client_key is deduped at ANY age (past the 3s window)', () => {
    expect(out[11].rows![0].r.was_new).toBe(false);
    expect(out[11].rows![0].r.event.id).toBe(out[9].rows![0].r.event.id);
    expect(out[12].rows![0].n).toBe(3);
  });
  it('K2-19 (a3ddf8b): a new key with the same content is a new event', () => {
    expect(out[13].rows![0].r.was_new).toBe(true);
    expect(out[14].rows![0].n).toBe(4);
  });
  it('K2-22 (0ed4e42): the function returns {event, was_new} jsonb', () => {
    expect(Object.keys(out[4].rows![0].r).sort()).toEqual(['event', 'was_new']);
  });
});

describe('K2-7 · kudos are one per (giver, receiver, match) — 048, codified by 078', () => {
  // 048 now skips when kudos doesn't exist yet (a fresh DB); 078 creates the
  // table with the inline UNIQUE on the triple. Run them in order, as a fresh
  // database would, and prove a concurrent double-kudos can't land twice.
  const kudosDdl = () => {
    const m = /CREATE TABLE IF NOT EXISTS kudos \([\s\S]*?\n\);/.exec(mig('078_codify_drifted_tables.sql'));
    if (!m) throw new Error('kudos DDL not found in 078');
    return m[0].replace(/REFERENCES \w+\(id\)/g, '');
  };
  it('K2-7 (0782390): after 048 + 078 a duplicate (from,to,match) insert is refused; re-running 048 is a no-op', () => {
    const out = pg([
      `CREATE TABLE follow_relationships (id serial, follower_id uuid, following_id uuid, UNIQUE (follower_id, following_id));
       CREATE TABLE team_members (id serial, team_id uuid, user_id uuid, UNIQUE (team_id, user_id));
       CREATE TABLE user_reviews (id serial, reviewer_id uuid, reviewed_id uuid, UNIQUE (reviewer_id, reviewed_id));`,
      mig('048_kudos_dedup_unique.sql'),
      kudosDdl(),
      `INSERT INTO kudos (from_user_id, to_user_id, match_id) VALUES ('${U1}','${U2}','${M1}')`,
      `INSERT INTO kudos (from_user_id, to_user_id, match_id) VALUES ('${U1}','${U2}','${M1}')`,
      `INSERT INTO kudos (from_user_id, to_user_id, match_id) VALUES ('${U2}','${U1}','${M1}')`,
      mig('048_kudos_dedup_unique.sql'),
      'SELECT count(*)::int AS n FROM kudos',
    ]);
    expect(ok(out.slice(0, 4))).toEqual([]);
    expect(out[4].error).toMatch(/duplicate key value violates unique constraint/);
    expect(out[5].error).toBeUndefined();
    expect(out[6].error).toBeUndefined();
    expect(out[7].rows![0].n).toBe(2);
  });
});

describe('K2-10 · migration 050 indexes scheduled posts (AUDIT-7)', () => {
  it('K2-10d (d02809c): a partial index on community_posts.scheduled_at WHERE scheduled_at IS NOT NULL', () => {
    const out = pg([
      'CREATE TABLE community_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scheduled_at timestamptz)',
      mig('050_community_posts_scheduled_at_index.sql'),
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_community_posts_scheduled_at'",
    ]);
    expect(ok(out)).toEqual([]);
    expect(out[2].rows![0].indexdef).toMatch(/\(scheduled_at\) WHERE \(scheduled_at IS NOT NULL\)/);
  });
});
