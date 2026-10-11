/**
 * Audit #23–#25 (11 Oct 2026, Dipak's decision 4): no user data is hard deleted.
 * Migration 147 archives every deleted row (deleted_records, with deleted_at /
 * deleted_by / deleted_reason) before it leaves its table, so every read skips
 * it with no change to the reads. Run on a real Postgres (PGlite).
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
const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '147_deleted_records.sql'), 'utf8');
const ARCHIVED = ['team_members', 'team_expenses', 'notifications', 'invites', 'user_reviews', 'tournament_organisers', 'tournament_officials', 'matches', 'match_participants', 'match_events'];

describe('audit #23–#25: deletes are archived, reads skip them', () => {
  const out = pg([
    ...ARCHIVED.map((t) => `CREATE TABLE ${t} (id uuid primary key default gen_random_uuid(), note text);`),
    `CREATE TABLE otp_codes (id uuid primary key default gen_random_uuid(), code text);`,
    `INSERT INTO team_members (id, note) VALUES ('00000000-0000-4000-8000-000000000001', 'Ravi in Lions'), ('00000000-0000-4000-8000-000000000002', 'Amit in Lions');`,
    `INSERT INTO match_events (id, note) VALUES ('00000000-0000-4000-8000-000000000003', 'four');`,
    `INSERT INTO otp_codes (code) VALUES ('123456');`,
    MIG,
    MIG, // safe to run twice
    `SELECT delete_with_reason('team_members', ARRAY['00000000-0000-4000-8000-000000000001']::uuid[], '00000000-0000-4000-8000-0000000000aa', 'removed by a team manager') AS n;`,
    `DELETE FROM match_events;`,
    `DELETE FROM otp_codes;`,
    `SELECT note FROM team_members ORDER BY note;`,
    `SELECT table_name, row ->> 'note' AS note, deleted_by::text AS by, deleted_reason AS why FROM deleted_records ORDER BY id;`,
    `SELECT delete_with_reason('otp_codes', ARRAY[]::uuid[], NULL, 'x');`,
  ]);
  const B = ARCHIVED.length + 4; // tables + otp_codes + 3 inserts, then the migration twice
  it('the migration runs cleanly, twice', () => {
    expect(out.slice(0, B + 2).filter((o) => o.error)).toEqual([]);
  });
  it('a removed member is gone from reads…', () => {
    expect(out[B + 2].rows?.[0]?.n).toBe(1);
    expect(out[B + 5].rows).toEqual([{ note: 'Amit in Lions' }]);
  });
  it('…but kept, whole, with who and why; a plain delete is archived too; codes are not', () => {
    expect(out[B + 6].rows).toEqual([
      { table_name: 'team_members', note: 'Ravi in Lions', by: '00000000-0000-4000-8000-0000000000aa', why: 'removed by a team manager' },
      { table_name: 'match_events', note: 'four', by: null, why: null },
    ]);
  });
  it('the function refuses a table that isn’t archived', () => {
    expect(out[B + 7].error).toMatch(/not an archived table/);
  });
});

describe('every delete in the code is on an archived table, or a credential / lock', () => {
  const EXEMPT = new Set(['otp_codes', 'refresh_tokens', 'push_tokens', 'notification_sends', 'VAR:table']);
  const mig = MIG;
  const files: string[] = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== '__tests__') walk(p); } else if (p.endsWith('.ts')) files.push(p); } };
  walk(path.join(ROOT, 'src'));
  it('no delete escapes the archive', () => {
    const escaped: string[] = [];
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/\.delete\(\)/g)) {
        const pre = s.slice(Math.max(0, m.index! - 400), m.index!);
        const tbl = [...pre.matchAll(/from\(\s*'([a-z_]+)'/g)].pop()?.[1] ?? (/from\(\s*table\s*\)/.test(pre) ? 'VAR:table' : '?');
        if (EXEMPT.has(tbl)) continue;
        if (!mig.includes(`'${tbl}'`)) escaped.push(`${path.relative(ROOT, f)}: ${tbl}`);
      }
    }
    expect(escaped).toEqual([]);
  });
});
