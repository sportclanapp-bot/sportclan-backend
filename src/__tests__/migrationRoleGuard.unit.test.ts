/**
 * Block 148 follow-up (12 Oct 2026, diagnosed on live). On Supabase, whatever supabase_admin makes in
 * schema public is handed to the public keys (anon, authenticated) by its default privileges, and
 * postgres — which runs our migrations — can't take it back (live: pg_trgm's 31 functions). So:
 *  · a migration never switches role (SET ROLE / SET SESSION AUTHORIZATION) or names supabase_admin;
 *  · a new extension goes in schema extensions — CREATE EXTENSION runs as supabase_admin on Supabase
 *    (exempt: what live already has, so the statement does nothing there — 001's pgcrypto, in
 *    extensions on live, and 059/079's pg_trgm, in public on live);
 *  · from 149 on, a new table turns row-level security on in the same migration (148 covered the rest);
 *  · 152 takes PUBLIC's execute off new functions globally (a per-schema revoke can't).
 */
import fs from 'fs';
import path from 'path';

const DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const files = fs.readdirSync(DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const sql = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
/** Comments out, then statements (good enough for this: no `;` inside the strings we look for). */
const statements = (f: string) =>
  sql(f).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split(';').map((s) => s.trim()).filter(Boolean);
const num = (f: string) => Number(f.split('_')[0]);

test('no migration switches role or names supabase_admin', () => {
  const bad = files.flatMap((f) => statements(f)
    .filter((s) => /^(SET|RESET)\s+(SESSION\s+|LOCAL\s+)?(ROLE|SESSION\s+AUTHORIZATION)\b/i.test(s) || /\bsupabase_admin\b/i.test(s))
    .map((s) => `${f}: ${s.slice(0, 60)}`));
  expect(bad).toEqual([]);
});

test('a new extension goes in schema extensions (exempt: the ones live already has)', () => {
  const bad = files.flatMap((f) => statements(f)
    .filter((s) => /^CREATE\s+EXTENSION\b/i.test(s) && !/\bSCHEMA\s+extensions\b/i.test(s))
    .filter((s) => !((num(f) === 1 && /\bpgcrypto\b/i.test(s)) || ([59, 79].includes(num(f)) && /\bpg_trgm\b/i.test(s))))
    .map((s) => `${f}: ${s.slice(0, 60)}`));
  expect(bad).toEqual([]);
});

test('from 149 on, every new table turns row-level security on in the same migration', () => {
  const bad = files.filter((f) => num(f) >= 149).flatMap((f) => {
    const text = statements(f).join(';\n');
    return [...text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi)].map((m) => m[1])
      .filter((t) => !new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(?:public\\.)?"?${t}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(text))
      .map((t) => `${f}: ${t}`);
  });
  expect(bad).toEqual([]);
});

test('152 takes PUBLIC’s execute off new functions globally, not per schema', () => {
  const s = statements('152_default_privileges_global.sql');
  expect(s.some((x) => /^ALTER\s+DEFAULT\s+PRIVILEGES\s+REVOKE\s+EXECUTE\s+ON\s+FUNCTIONS\s+FROM\s+PUBLIC$/i.test(x))).toBe(true);
  expect(s.some((x) => /^ALTER\s+DEFAULT\s+PRIVILEGES\s+IN\s+SCHEMA/i.test(x))).toBe(false);
});

test('the guard itself catches what it should', () => {
  const st = (t: string) => t.split(';').map((s) => s.trim()).filter(Boolean);
  expect(st('UPDATE team_members SET role = 1; SET ROLE supabase_admin').filter((s) => /^(SET|RESET)\s+(SESSION\s+|LOCAL\s+)?(ROLE|SESSION\s+AUTHORIZATION)\b/i.test(s))).toEqual(['SET ROLE supabase_admin']);
  expect(/^CREATE\s+EXTENSION\b/i.test('CREATE EXTENSION hstore') && !/\bSCHEMA\s+extensions\b/i.test('CREATE EXTENSION hstore')).toBe(true);
});
