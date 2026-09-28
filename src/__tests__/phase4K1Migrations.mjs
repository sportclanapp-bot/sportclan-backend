// Phase 4 · K1-13 / K1-29a — migrations 025 and 030 run VERBATIM on PGlite
// (in-process Postgres). Run by phase4K1Migrations.unit.test.ts as a child
// process (PGlite needs Node's ESM loader). One line per assertion.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const mig = (f) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations', f), 'utf8');
const ok = (label, cond, got) => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ` (got ${got})`}`);

// ── 025: tournaments.city TEXT ────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(`CREATE TABLE tournaments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, city_id uuid);`);
  await db.exec(mig('025_tournament_city_text.sql'));
  await db.exec(mig('025_tournament_city_text.sql')); // re-runnable
  const col = (await db.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'tournaments' AND column_name = 'city'`)).rows[0];
  ok('025 adds tournaments.city as text', col?.data_type === 'text', JSON.stringify(col));
  const row = (await db.query(`INSERT INTO tournaments (name, city) VALUES ('Pune Cup', 'Pune') RETURNING city`)).rows[0];
  ok('a typed city name is stored', row.city === 'Pune', row.city);
}

// ── 030: deduct_coins_if_sufficient ───────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(`CREATE TABLE users (id uuid PRIMARY KEY, coin_balance integer NOT NULL DEFAULT 0);
    INSERT INTO users VALUES ('11111111-1111-4111-8111-111111111111', 10);`);
  await db.exec(mig('030_atomic_gift_deduct.sql'));
  const U = '11111111-1111-4111-8111-111111111111';
  const deduct = async (n) => (await db.query(`SELECT deduct_coins_if_sufficient('${U}', ${n}) AS b`)).rows[0].b;
  const bal = async () => (await db.query(`SELECT coin_balance FROM users WHERE id = '${U}'`)).rows[0].coin_balance;
  const a = await deduct(8);
  ok('030 deducts when the balance covers it and returns the new balance', a === 2, a);
  const b = await deduct(8);
  ok('030 returns NULL when the balance does not cover it', b === null, b);
  const c = await bal();
  ok('030 never drives the balance below zero (balance still 2)', c === 2, c);
  const d = await deduct(2);
  ok('030 allows spending exactly the whole balance', d === 0, d);
}
