/**
 * Audit #8 (11 Oct 2026, Dipak's decision 3): "Show date of birth" is OFF by
 * default. Migration 143, run on a real Postgres (PGlite): new accounts off;
 * existing accounts that never chose → off; anyone who turned it on → stays on.
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
function pg(steps: string[]): Array<{ rows?: any[]; error?: string }> {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER], { cwd: ROOT, input: JSON.stringify(steps), encoding: 'utf8', timeout: 120000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`PGlite runner failed: ${r.stderr}`);
  return JSON.parse(line.slice(2));
}
const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '143_show_dob_default_off.sql'), 'utf8');

describe('audit #8: date of birth hidden by default', () => {
  const out = pg([
    `CREATE TABLE users (id text primary key, created_at timestamptz not null, show_dob boolean not null default true);`,
    `INSERT INTO users VALUES ('old-default', '2026-08-01', true), ('old-hidden', '2026-08-01', false), ('new-turned-on', '2026-10-05', true), ('new-hidden', '2026-10-05', false);`,
    MIG,
    MIG, // safe to run twice
    `INSERT INTO users (id, created_at) VALUES ('brand-new', now());`,
    `SELECT id, show_dob FROM users ORDER BY id;`,
  ]);
  it('runs cleanly twice', () => {
    expect(out.filter((o) => o.error)).toEqual([]);
  });
  it('old accounts that never chose become hidden; choices made since stay', () => {
    const map = Object.fromEntries((out[5].rows ?? []).map((r: any) => [r.id, r.show_dob]));
    expect(map).toEqual({ 'brand-new': false, 'new-hidden': false, 'new-turned-on': true, 'old-default': false, 'old-hidden': false });
  });
});
