// Migration 098 · the test-content trigger, proven on a REAL Postgres (PGlite,
// in-process). Runs the migration's blocks 2–3 and CHECK-098's blocks 3–4
// VERBATIM from the files, plus a real insert into each of the six tables by a
// test and a real account, and a match inside a flagged tournament.
// Prints one line per assertion; exits 1 on the first failure.
// Run: node scripts/prove-098-trigger.mjs   (also run by migration098Trigger.unit.test.ts)
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const MIG = fs.readFileSync(path.join(root, 'migrations/098_soft_deletes_and_test_flag_trigger.sql'), 'utf8');
const CHK = fs.readFileSync(path.join(root, 'checks/CHECK-098-soft-deletes-and-trigger.sql'), 'utf8');
const block = (src, n) => {
  const p = src.split(/-- -{70,}\n-- BLOCK /).find((x) => x.startsWith(`${n} `));
  if (!p) throw new Error(`block ${n} not found`);
  return p.slice(p.indexOf('\n-- ---') + 1).replace(/^-- -+\n/, '');
};
const SCHEMA = `
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text, is_test_seed boolean NOT NULL DEFAULT false);
CREATE TABLE teams (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, join_code text NOT NULL, created_by uuid REFERENCES users(id), is_test_seed boolean NOT NULL DEFAULT false);
CREATE TABLE tournaments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), is_test_seed boolean NOT NULL DEFAULT false);
CREATE TABLE matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'scheduled', created_by uuid REFERENCES users(id), tournament_id uuid REFERENCES tournaments(id), is_test_seed boolean NOT NULL DEFAULT false);
CREATE TABLE community_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL REFERENCES users(id), content text NOT NULL, is_test_seed boolean NOT NULL DEFAULT false);
CREATE TABLE chats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid NOT NULL REFERENCES users(id), is_test_seed boolean NOT NULL DEFAULT false);
CREATE TABLE venues (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, created_by uuid REFERENCES users(id), is_test_seed boolean NOT NULL DEFAULT false);
CREATE TABLE user_badges (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, badge_id uuid);
CREATE TABLE chat_participants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid, user_id uuid);
INSERT INTO users (username, is_test_seed) VALUES ('qadev_a_qa', true), ('dipak', false);
INSERT INTO tournaments (name, created_by, is_test_seed) SELECT 'flagged cup', id, true FROM users WHERE username = 'qadev_a_qa';`;

const db = new PGlite();
let failed = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ` (got ${got})`}`); if (!cond) failed++; };
await db.exec(SCHEMA);
await db.exec(block(MIG, 2));
await db.exec(block(MIG, 3));
ok('block 3 never names a column on NEW (outside comments)', !/NEW\.(author_id|created_by|tournament_id)/.test(block(MIG, 3).replace(/--.*$/gm, '')), 'NEW.<col> present');
const by = (u) => `(SELECT id FROM users WHERE username = '${u}')`;
const ins = {
  teams: (u) => `INSERT INTO teams (name, join_code, created_by) VALUES ('T', 'J', ${by(u)}) RETURNING is_test_seed`,
  tournaments: (u) => `INSERT INTO tournaments (name, created_by) VALUES ('C', ${by(u)}) RETURNING is_test_seed`,
  matches: (u) => `INSERT INTO matches (created_by) VALUES (${by(u)}) RETURNING is_test_seed`,
  community_posts: (u) => `INSERT INTO community_posts (author_id, content) VALUES (${by(u)}, 'p') RETURNING is_test_seed`,
  chats: (u) => `INSERT INTO chats (created_by) VALUES (${by(u)}) RETURNING is_test_seed`,
  venues: (u) => `INSERT INTO venues (name, created_by) VALUES ('V', ${by(u)}) RETURNING is_test_seed`,
};
for (const [t, sql] of Object.entries(ins)) {
  for (const [who, want] of [['qadev_a_qa', true], ['dipak', false]]) {
    try {
      const f = (await db.query(sql(who))).rows[0].is_test_seed;
      ok(`${t} by ${who} inserts, flagged=${want}`, f === want, f);
    } catch (e) { ok(`${t} by ${who} inserts`, false, e.message); }
  }
}
const m = (await db.query(`INSERT INTO matches (created_by, tournament_id) VALUES (${by('dipak')}, (SELECT id FROM tournaments WHERE name = 'flagged cup')) RETURNING is_test_seed`)).rows[0].is_test_seed;
ok('match by dipak in a flagged tournament is flagged', m === true, m);
const o = (await db.query(`INSERT INTO venues (name) VALUES ('orphan') RETURNING is_test_seed`)).rows[0].is_test_seed;
ok('row with no creator inserts, not flagged', o === false, o);
for (const n of [3, 4]) {
  try { await db.exec(block(CHK, n)); ok(`CHECK-098 block ${n} raises PASS`, false, 'no error'); }
  catch (e) { ok(`CHECK-098 block ${n} raises PASS`, /^CHECK-098 PASS/.test(e.message), e.message); }
}
await db.close();
process.exit(failed ? 1 : 0);
