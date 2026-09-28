// Phase 4 · K1-51 / K1-55 — migrations 042 and 044 run VERBATIM on PGlite
// (in-process Postgres). Run by phase4K1F2Migrations.unit.test.ts as a child
// process (PGlite needs Node's ESM loader). One line per assertion.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const mig = (f) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations', f), 'utf8');
let failed = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ` (got ${got})`}`); if (!cond) failed++; };

// ── 042: dm_key backfill ──────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE chats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_group boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE chat_participants (chat_id uuid REFERENCES chats(id), user_id uuid NOT NULL);
    -- a DM between U1/U2 (older), a duplicate DM for the same pair (newer),
    -- a DM whose user ids differ only past the first hex char, and a group.
    INSERT INTO chats (id, is_group, created_at) VALUES
      ('10000000-0000-4000-8000-000000000001', false, '2026-01-01'),
      ('10000000-0000-4000-8000-000000000002', false, '2026-02-01'),
      ('10000000-0000-4000-8000-000000000003', false, '2026-01-01'),
      ('10000000-0000-4000-8000-000000000004', true,  '2026-01-01');
    INSERT INTO chat_participants VALUES
      ('10000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-00000000000a'),
      ('10000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000b'),
      ('10000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-00000000000b'),
      ('10000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-00000000000a'),
      ('10000000-0000-4000-8000-000000000003', 'ab000000-0000-4000-8000-00000000000c'),
      ('10000000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-00000000000d'),
      ('10000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-00000000000a'),
      ('10000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-00000000000b');`);
  let ran = true;
  try { await db.exec(mig('042_dm_unique_key.sql')); } catch (e) { ran = false; ok('042 runs on a real Postgres (no MIN(uuid))', false, e.message); }
  if (ran) {
    ok('042 runs on a real Postgres (no MIN(uuid))', true);
    const key = async (id) => (await db.query(`SELECT dm_key FROM chats WHERE id = '${id}'`)).rows[0].dm_key;
    const js = (a, b) => [a, b].sort().join(':');
    const k1 = await key('10000000-0000-4000-8000-000000000001');
    ok('042: backfilled key is byte-identical to the controller\'s [a,b].sort().join(":")', k1 === js('f0000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-00000000000b'), k1);
    const k3 = await key('10000000-0000-4000-8000-000000000003');
    ok('042: second pair matches the JS sort too', k3 === js('ab000000-0000-4000-8000-00000000000c', 'a9000000-0000-4000-8000-00000000000d'), k3);
    ok('042: the newer duplicate DM keeps NULL (index still builds)', (await key('10000000-0000-4000-8000-000000000002')) === null, 'non-null');
    ok('042: a group chat keeps NULL', (await key('10000000-0000-4000-8000-000000000004')) === null, 'non-null');
    let dupRefused = false;
    try { await db.exec(`INSERT INTO chats (is_group, dm_key) VALUES (false, '${k1}')`); } catch { dupRefused = true; }
    ok('042: a second DM for the same pair is refused by the unique index', dupRefused, 'inserted');
  }
}

// ── 044: public.users.deleted_at ──────────────────────────────────────────────
{
  const db = new PGlite();
  // Prod as it was: a users table WITHOUT deleted_at.
  await db.exec(`CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
                 INSERT INTO users (name) VALUES ('a');`);
  let err = null;
  try { await db.exec(`UPDATE users SET deleted_at = now(), name = 'Deleted User'`); } catch (e) { err = e.message; }
  ok('044: control: the delete UPDATE fails without the column (the SC-69 500)', !!err, 'no error');
  await db.exec(mig('044_users_deleted_at.sql'));
  await db.exec(mig('044_users_deleted_at.sql')); // idempotent
  err = null;
  try { await db.exec(`UPDATE users SET deleted_at = now(), name = 'Deleted User'`); } catch (e) { err = e.message; }
  ok('044: after 044 (run twice) the account-delete UPDATE succeeds', err === null, err);
  const idx = (await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_users_deleted_at'`)).rows[0]?.indexdef ?? '';
  ok('044: partial index on deleted_at exists', /WHERE \(deleted_at IS NOT NULL\)/.test(idx), idx);
}

process.exit(failed ? 1 : 0);
