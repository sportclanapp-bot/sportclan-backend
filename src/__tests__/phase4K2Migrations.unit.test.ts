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

describe('K2-12 / K2-18 · finalize_match (migrations 051 → 054)', () => {
  const SP = '66666666-6666-4666-8666-666666666666';
  const M2 = '77777777-7777-4777-8777-777777777777';
  const M3 = '88888888-8888-4888-8888-888888888888';
  const SCHEMA = `
    CREATE TABLE matches (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'live', winner_team_id uuid, updated_at timestamptz);
    CREATE TABLE user_sport_profiles (user_id uuid, sport_id uuid, rating numeric NOT NULL DEFAULT 1000, matches_played int NOT NULL DEFAULT 0,
      wins int NOT NULL DEFAULT 0, losses int NOT NULL DEFAULT 0, draws int NOT NULL DEFAULT 0, last_match_at timestamptz, updated_at timestamptz,
      UNIQUE (user_id, sport_id));
    CREATE TABLE rating_history (id serial PRIMARY KEY, user_id uuid, sport_id uuid, match_id uuid REFERENCES matches(id), old_rating numeric, new_rating numeric, delta numeric);
    INSERT INTO matches (id) VALUES ('${M1}'), ('${M2}'), ('${M3}');`;
  // Absolute fields carry a STALE read (both say 1005 / 1 match) — only the deltas may count.
  const prof = (delta: number, win: number) => `{"user_id":"${U1}","sport_id":"${SP}","rating":1005,"matches_played":1,"wins":1,"losses":0,"draws":0,"rating_delta":${delta},"win_inc":${win},"loss_inc":${1 - win},"draw_inc":0}`;
  const fin = (m: string, delta: number, win: number) => `SELECT finalize_match('${m}', '{"winner_team_id":null,"profiles":[${prof(delta, win)}]}'::jsonb) AS r`;
  const profile = `SELECT rating::float AS rating, matches_played, wins, losses FROM user_sport_profiles WHERE user_id = '${U1}'`;
  let out: Step[];
  beforeAll(() => {
    out = pg([
      SCHEMA, mig('051_finalize_match_atomic.sql'), mig('054_finalize_match_atomic_deltas.sql'),
      fin(M1, 10, 1), fin(M2, 5, 0), profile, // 3,4,5: two completions build on each other
      `SELECT old_rating::float AS o, new_rating::float AS n FROM rating_history WHERE match_id = '${M2}'`, // 6
      fin(M1, 10, 1), profile, // 7,8: a retried completion is a no-op
      `CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rh write failed'; END $$;
       CREATE TRIGGER rh_boom BEFORE INSERT ON rating_history FOR EACH ROW EXECUTE FUNCTION boom();`, // 9
      fin(M3, 7, 1), profile, `SELECT status FROM matches WHERE id = '${M3}'`, // 10,11,12: a mid-transaction failure
    ]);
  });
  it('K2-12/K2-18: the migrations apply', () => expect(ok(out.slice(0, 3))).toEqual([]));
  it('K2-18 (6d1e7db): deltas apply additively to the CURRENT row, not the stale absolute values', () => {
    expect(out[5].rows![0]).toEqual({ rating: 1015, matches_played: 2, wins: 1, losses: 1 });
    expect(out[6].rows![0]).toEqual({ o: 1010, n: 1015 }); // history records the exact pre-update rating
  });
  it('K2-12 (d010d90): completing an already-completed match is applied:false and changes nothing', () => {
    expect(out[7].rows![0].r.applied).toBe(false);
    expect(out[8].rows![0]).toEqual({ rating: 1015, matches_played: 2, wins: 1, losses: 1 });
  });
  it('K2-12 (d010d90): a failure mid-way rolls EVERYTHING back — no rating change, status not completed', () => {
    expect(out[10].error).toMatch(/rh write failed/);
    expect(out[11].rows![0]).toEqual({ rating: 1015, matches_played: 2, wins: 1, losses: 1 });
    expect(out[12].rows![0].status).toBe('live');
  });
});

describe('K2-15 · send_gift (migration 052)', () => {
  const G = (key: string | null, cost = 10, gift = 'gold_trophy') => `SELECT send_gift('${U1}','${U2}','${gift}','🏆','Gold Trophy',${cost},NULL,${key ? `'${key}'` : 'NULL'}) AS r`;
  let out: Step[];
  beforeAll(() => {
    out = pg([
      `CREATE TABLE users (id uuid PRIMARY KEY, coin_balance int NOT NULL DEFAULT 0);
       CREATE TABLE gift_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender_id uuid, receiver_id uuid, gift_id text, gift_emoji text,
         gift_name text, coin_cost int, message text, created_at timestamptz NOT NULL DEFAULT now());
       CREATE TABLE transactions (id serial PRIMARY KEY, user_id uuid, type text, coins int, description text, reference_id text, status text);
       INSERT INTO users VALUES ('${U1}', 25), ('${U2}', 0);`,
      mig('052_send_gift_idempotent.sql'),
      G(K1), G(K1), // 2,3: a lost-response re-tap with the same key
      'SELECT (SELECT coin_balance FROM users WHERE id = ' + `'${U1}'` + ') AS bal, (SELECT count(*)::int FROM gift_transactions) AS gifts, (SELECT count(*)::int FROM transactions) AS ledger', // 4
      G(K2, 999), 'SELECT (SELECT count(*)::int FROM gift_transactions) AS gifts, (SELECT coin_balance FROM users WHERE id = ' + `'${U1}'` + ') AS bal', // 5,6: insufficient
      G(null, 1, 'rose'), G(null, 1, 'rose'), 'SELECT count(*)::int AS gifts FROM gift_transactions', // 7,8,9: no-key double send within the backstop
    ]);
  });
  it('K2-15: the migration applies', () => expect(ok(out.slice(0, 2))).toEqual([]));
  it('K2-15 (3bcb64b): the same key twice → one gift, one deduct, one ledger pair; the retry says duplicate', () => {
    expect(out[2].rows![0].r.status).toBe('sent');
    expect(out[3].rows![0].r.status).toBe('duplicate');
    expect(out[3].rows![0].r.gift.id).toBe(out[2].rows![0].r.gift.id);
    expect(out[4].rows![0]).toEqual({ bal: 15, gifts: 1, ledger: 2 });
  });
  it('K2-15 (3bcb64b): insufficient coins → no gift row left behind, balance untouched', () => {
    expect(out[5].rows![0].r).toEqual({ status: 'insufficient' });
    expect(out[6].rows![0]).toEqual({ gifts: 1, bal: 15 });
  });
  it('K2-15 (3bcb64b): with no key, an identical send inside the backstop window is a duplicate', () => {
    expect(out[7].rows![0].r.status).toBe('sent');
    expect(out[8].rows![0].r.status).toBe('duplicate');
    expect(out[9].rows![0].gifts).toBe(2);
  });
});

describe('K2-16 · post + comment idempotency (053, create_post_capped as of 091)', () => {
  const postFn = () => {
    const m = /CREATE OR REPLACE FUNCTION create_post_capped\([\s\S]*?\$\$ LANGUAGE plpgsql;/.exec(mig('091_drop_premium_leftovers.sql'));
    if (!m) throw new Error('create_post_capped not found in 091');
    return m[0];
  };
  const P = (content: string, key: string | null) =>
    `SELECT id FROM create_post_capped(p_author_id => '${U1}', p_content => '${content}', p_image_url => NULL, p_link_url => NULL, p_sport_id => NULL,
      p_city_id => NULL, p_post_type => 'general', p_mentions => NULL, p_poll_options => NULL, p_scheduled_at => NULL, p_client_key => ${key ? `'${key}'::uuid` : 'NULL'})`;
  let out: Step[];
  beforeAll(() => {
    out = pg([
      `CREATE TABLE community_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid, content text, image_url text, link_url text, sport_id uuid,
         city_id uuid, post_type text, mentions uuid[], poll_options jsonb, scheduled_at timestamptz, match_id uuid, created_at timestamptz NOT NULL DEFAULT now());
       CREATE TABLE post_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid, author_id uuid, content text, created_at timestamptz NOT NULL DEFAULT now());`,
      mig('053_post_comment_idempotent.sql'),
      postFn(),
      P('gg', K1), P('gg', K1), `UPDATE community_posts SET created_at = now() - interval '1 hour'`, P('gg', K1), // 3,4,5,6
      P('new one', null), P('new one', null), 'SELECT count(*)::int AS n FROM community_posts', // 7,8,9
      `INSERT INTO post_comments (post_id, author_id, content, client_key) VALUES ('${M1}','${U1}','nice','${K1}')`,
      `INSERT INTO post_comments (post_id, author_id, content, client_key) VALUES ('${M1}','${U1}','nice','${K1}')`, // 11
      `INSERT INTO post_comments (post_id, author_id, content) VALUES ('${M1}','${U1}','nice'), ('${M1}','${U1}','nice')`, // 12: no key → no constraint
    ]);
  });
  it('K2-16: 053 and the current create_post_capped apply', () => expect(ok(out.slice(0, 3))).toEqual([]));
  it('K2-16d (abe1ffc): a same-key post retry — even an hour later — returns the original post', () => {
    expect(out[4].rows![0].id).toBe(out[3].rows![0].id);
    expect(out[6].rows![0].id).toBe(out[3].rows![0].id);
  });
  it('K2-16d (abe1ffc): a no-key identical post inside 2s is the same post', () => {
    expect(out[8].rows![0].id).toBe(out[7].rows![0].id);
    expect(out[9].rows![0].n).toBe(2);
  });
  it('K2-16e (abe1ffc): post_comments refuses a second row with the same (author, client_key); keyless rows are free', () => {
    expect(out[10].error).toBeUndefined();
    expect(out[11].error).toMatch(/uq_post_comments_author_client_key/);
    expect(out[12].error).toBeUndefined();
  });
});

describe('K2-77d · migration 074 adds media_urls (SC-350)', () => {
  it('K2-77d (d0d25d3): community_posts gains a text[] media_urls; existing single images are carried into it', () => {
    const out = pg([
      "CREATE TABLE community_posts (id serial PRIMARY KEY, image_url text); INSERT INTO community_posts (image_url) VALUES ('https://x/1.jpg'), (NULL), ('')",
      mig('074_post_media_urls.sql'),
      'SELECT id, media_urls FROM community_posts ORDER BY id',
      "UPDATE community_posts SET media_urls = ARRAY['a','b','c','d'] WHERE id = 2",
      mig('074_post_media_urls.sql'),
    ]);
    expect(ok(out)).toEqual([]);
    expect(out[2].rows).toEqual([{ id: 1, media_urls: ['https://x/1.jpg'] }, { id: 2, media_urls: null }, { id: 3, media_urls: null }]);
  });
});
