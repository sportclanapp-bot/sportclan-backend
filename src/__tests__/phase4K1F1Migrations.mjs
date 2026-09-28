// Phase 4 · K1 — migrations 035, 036, 038, 041/073, 042, 043 and 095's
// join_open_match, run VERBATIM from supabase/migrations on PGlite (in-process
// Postgres). Prints one PASS/FAIL line per assertion; exits 1 on any failure.
// Run by phase4K1F1Migrations.unit.test.ts (PGlite needs Node's ESM loader).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');
const mig = (n) => fs.readFileSync(path.join(MIG, fs.readdirSync(MIG).find((f) => f.startsWith(`${n}_`))), 'utf8');

const db = new PGlite();
let failed = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ` (got ${got})`}`); if (!cond) failed++; };
const rejects = async (sql) => { try { await db.query(sql); return null; } catch (e) { return e; } };
const execFails = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return e; } };
const one = async (sql) => (await db.query(sql)).rows[0];

await db.exec(`
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE tournaments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid REFERENCES tournaments(id),
  is_open boolean DEFAULT false, status text NOT NULL DEFAULT 'scheduled', players_needed int, updated_at timestamptz DEFAULT now());
CREATE TABLE match_participants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid REFERENCES matches(id), user_id uuid, team_side text);
CREATE TABLE community_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), poll_options jsonb);
CREATE TABLE chats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_group boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE chat_participants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid REFERENCES chats(id), user_id uuid);
CREATE TABLE user_sport_profiles (user_id uuid, sport_id uuid, rating int, wins int, matches_played int);
CREATE TABLE rating_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sport_id uuid, created_at timestamptz DEFAULT now());
INSERT INTO users (id, name) VALUES ('00000000-0000-4000-8000-00000000000a', 'a'), ('00000000-0000-4000-8000-00000000000b', 'b'), ('f0000000-0000-4000-8000-00000000000c', 'c');
`);
// 027's poll_votes, as the base 041 and 073 build on.
const p027 = mig('027');
await db.exec(p027.slice(p027.indexOf('CREATE TABLE IF NOT EXISTS poll_votes'), p027.indexOf(';', p027.indexOf('CREATE TABLE IF NOT EXISTS poll_votes')) + 1));

// ── 035 · fixtures_generated (K1-46b) ─────────────────────────────────────────
await db.exec(`INSERT INTO tournaments (id, name) VALUES ('10000000-0000-4000-8000-000000000001', 'has fixtures'), ('10000000-0000-4000-8000-000000000002', 'fresh');
INSERT INTO matches (tournament_id) VALUES ('10000000-0000-4000-8000-000000000001');`);
await db.exec(mig('035'));
ok('035 backfills: a tournament with matches is already generated', (await one(`SELECT fixtures_generated f FROM tournaments WHERE name='has fixtures'`)).f === true);
ok('035 a fresh tournament starts ungenerated', (await one(`SELECT fixtures_generated f FROM tournaments WHERE name='fresh'`)).f === false);
const c1 = await db.query(`UPDATE tournaments SET fixtures_generated = true WHERE name='fresh' AND fixtures_generated = false RETURNING id`);
const c2 = await db.query(`UPDATE tournaments SET fixtures_generated = true WHERE name='fresh' AND fixtures_generated = false RETURNING id`);
ok('035 the claim: exactly one of two claims gets the row', c1.rows.length === 1 && c2.rows.length === 0, `${c1.rows.length}/${c2.rows.length}`);

// ── 036 · tournament_officials.role takes 'referee' (K1-47) ──────────────────
await db.exec(mig('020'));
const ins = (role) => `INSERT INTO tournament_officials (tournament_id, user_id, role) VALUES ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', '${role}')`;
ok('036 before: 020 refuses a referee (the SC-56 bug)', !!(await rejects(ins('referee'))));
await db.exec(mig('036'));
ok('036 after: a referee is accepted', (await rejects(ins('referee'))) === null);
ok('036 the old roles still work', (await rejects(ins('umpire'))) === null && (await rejects(ins('scorer'))) === null && (await rejects(ins('commentator'))) === null);
ok('036 junk is still refused', !!(await rejects(ins('mascot'))));
ok('036 is idempotent (re-run)', (await execFails(mig("036"))) === null);

// ── 038 · groups_knockout config columns (K1-48c) ─────────────────────────────
await db.exec(mig('038'));
const cfg = await one(`INSERT INTO tournaments (name, num_groups, group_size) VALUES ('g', 3, 4) RETURNING num_groups, group_size, qualifiers_per_group`);
ok('038 num_groups/group_size stored; qualifiers_per_group defaults to 2', cfg.num_groups === 3 && cfg.group_size === 4 && cfg.qualifiers_per_group === 2, JSON.stringify(cfg));

// ── 041 + 073 · poll counts are recomputed from poll_votes (K1-50c) ──────────
await db.exec(mig('041'));
const post = (await one(`INSERT INTO community_posts (poll_options) VALUES ('[{"id":"o1","text":"x","vote_count":99},{"id":"o2","text":"y","vote_count":0}]') RETURNING id`)).id;
const counts = async () => Object.fromEntries((await one(`SELECT poll_options p FROM community_posts WHERE id='${post}'`)).p.map((o) => [o.id, o.vote_count]));
await db.query(`SELECT * FROM apply_poll_vote('${post}', '00000000-0000-4000-8000-00000000000a', 'o1')`);
await db.query(`SELECT * FROM apply_poll_vote('${post}', '00000000-0000-4000-8000-00000000000b', 'o1')`);
await db.query(`SELECT * FROM apply_poll_vote('${post}', '00000000-0000-4000-8000-00000000000a', 'o2')`);
let c = await counts();
ok('041 a stale denormalized count (99) is replaced by the real tally; a changed vote moves', c.o1 === 1 && c.o2 === 1, JSON.stringify(c));
await db.exec(mig('073'));
await db.query(`SELECT * FROM apply_poll_vote_set('${post}', '00000000-0000-4000-8000-00000000000b', ARRAY['o1','o2'])`);
c = await counts();
const voters = (await one(`SELECT poll_voter_count v FROM community_posts WHERE id='${post}'`)).v;
ok('073 the set vote recounts options and distinct voters', c.o1 === 1 && c.o2 === 2 && voters === 2, `${JSON.stringify(c)} voters=${voters}`);
await db.query(`SELECT * FROM apply_poll_vote_set('${post}', '00000000-0000-4000-8000-00000000000b', ARRAY[]::text[])`);
c = await counts();
ok('073 an empty set removes the vote', c.o1 === 0 && c.o2 === 1, JSON.stringify(c));

// ── 042 · one DM per pair (K1-50d; the uuid MIN/MAX cast is K1-51) ───────────
const A = '00000000-0000-4000-8000-00000000000a';
const B = 'f0000000-0000-4000-8000-00000000000c';
await db.exec(`
INSERT INTO chats (id, is_group, created_at) VALUES
  ('20000000-0000-4000-8000-000000000001', false, now() - interval '2 days'),
  ('20000000-0000-4000-8000-000000000002', false, now() - interval '1 day'),
  ('20000000-0000-4000-8000-000000000003', true, now());
INSERT INTO chat_participants (chat_id, user_id) VALUES
  ('20000000-0000-4000-8000-000000000001', '${B}'), ('20000000-0000-4000-8000-000000000001', '${A}'),
  ('20000000-0000-4000-8000-000000000002', '${A}'), ('20000000-0000-4000-8000-000000000002', '${B}'),
  ('20000000-0000-4000-8000-000000000003', '${A}'), ('20000000-0000-4000-8000-000000000003', '${B}');`);
ok('042 runs on real uuid columns (no min(uuid) error)', (await execFails(mig("042"))) === null);
const keys = (await db.query(`SELECT id, dm_key FROM chats ORDER BY created_at`)).rows;
const want = [A, B].sort().join(':');
ok('042 the oldest DM gets the JS-sorted pair key', keys[0].dm_key === want, keys[0].dm_key);
ok('042 a legacy duplicate DM and a group keep NULL', keys[1].dm_key === null && keys[2].dm_key === null, JSON.stringify(keys));
const dup = await rejects(`INSERT INTO chats (is_group, dm_key) VALUES (false, '${want}')`);
ok('042 a second DM for the same pair is a unique violation (23505)', dup?.code === '23505', dup?.code);
ok('042 group chats (NULL key) are unaffected', (await rejects(`INSERT INTO chats (is_group) VALUES (true)`)) === null);

// ── 043 · leaderboard indexes (K1-50f) ────────────────────────────────────────
await db.exec(mig('043'));
const idx = (await db.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_usp_leaderboard', 'idx_rh_sport_created')`)).rows.map((r) => r.indexname).sort();
ok('043 both leaderboard indexes exist', idx.join(',') === 'idx_rh_sport_created,idx_usp_leaderboard', idx.join(','));

// ── 095 (current join_open_match; SC-59 capacity lives here) (K1-50a) ─────────
await db.exec(mig('095'));
const m = (await one(`INSERT INTO matches (is_open, status, players_needed) VALUES (true, 'scheduled', 2) RETURNING id`)).id;
const join = async (u) => (await one(`SELECT * FROM join_open_match('${m}', '${u}')`));
const j1 = await join('00000000-0000-4000-8000-00000000000a');
const j1b = await join('00000000-0000-4000-8000-00000000000a');
const j2 = await join('00000000-0000-4000-8000-00000000000b');
const j3 = await join('f0000000-0000-4000-8000-00000000000c');
ok('095 joins decrement the slots', j1.status === 'joined' && j1.players_needed === 1 && j2.status === 'joined' && j2.players_needed === 0, `${JSON.stringify(j1)} ${JSON.stringify(j2)}`);
ok('095 a repeat join is idempotent (already_joined), not a second seat', j1b.status === 'already_joined', j1b.status);
ok('095 no oversell: the third joiner is told "full"', j3.status === 'full', j3.status);
const n = (await one(`SELECT count(*)::int n FROM match_participants WHERE match_id='${m}'`)).n;
ok('095 exactly two participants, never three', n === 2, n);

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
