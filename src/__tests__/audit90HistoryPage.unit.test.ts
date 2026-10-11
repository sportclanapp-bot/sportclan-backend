/**
 * Audit #90 (11 Oct 2026): Profile → Matches took ~31 s on live for a busy
 * account — the server read every one of the person's matches (about 75 round
 * trips) to show 20. Migration 150's match_history_page does it in one query;
 * the server then loads only the page.
 *  1. The function on a real Postgres (PGlite): order, counts, played-over-
 *     officiated, search (stored names and team names), voided hidden, paging.
 *  2. The server: one call for the page, then only the page's matches.
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
const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '150_match_history_page.sql'), 'utf8');
const U = '00000000-0000-4000-8000-000000000001';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('audit #90 · match_history_page', () => {
  const out = pg([
    `CREATE TABLE teams (id uuid primary key, name text);`,
    `CREATE TABLE matches (id uuid primary key, status text, voided_at timestamptz, completed_at timestamptz, updated_at timestamptz, scheduled_at timestamptz, team_a_name text, team_b_name text, team_a_id uuid, team_b_id uuid, umpire_id uuid);`,
    `CREATE TABLE match_participants (match_id uuid, user_id uuid, team_side text);`,
    `INSERT INTO teams VALUES ('${id(900)}', 'Royal Lions');`,
    // 1: played, oldest · 2: played, voided · 3: officiated · 4: played + officiated · 5: live (not history) · 6: played, abandoned, newest, vs a registered team
    `INSERT INTO matches VALUES
      ('${id(1)}', 'completed', null, '2026-10-01', null, null, 'Reds', 'Blues', null, null, null),
      ('${id(2)}', 'completed', '2026-10-05', '2026-10-02', null, null, 'Reds', 'Greens', null, null, null),
      ('${id(3)}', 'completed', null, '2026-10-03', null, null, 'Owls', 'Bats', null, null, '${U}'),
      ('${id(4)}', 'completed', null, '2026-10-04', null, null, 'Reds', 'Hawks', null, null, '${U}'),
      ('${id(5)}', 'live', null, null, '2026-10-06', null, 'Reds', 'Kites', null, null, null),
      ('${id(6)}', 'abandoned', null, null, '2026-10-07', null, null, null, '${id(900)}', null, null);`,
    `INSERT INTO match_participants VALUES ('${id(1)}', '${U}', 'A'), ('${id(2)}', '${U}', 'B'), ('${id(4)}', '${U}', 'A'), ('${id(5)}', '${U}', 'A'), ('${id(6)}', '${U}', 'B');`,
    MIG, MIG, // safe to run twice (no roles here: the grants are skipped)
    `SELECT match_history_page('${U}', 0, 3) AS h;`,
    `SELECT match_history_page('${U}', 3, 3) AS h;`,
    `SELECT match_history_page('${U}', 0, 10, 'lions') AS h;`,
    `SELECT match_history_page('${U}', 0, 10, NULL, true) AS h;`,
  ]);
  const h = (i: number) => out[i]!.rows![0].h;
  it('runs cleanly twice', () => expect(out.filter((o) => o.error)).toEqual([]));
  it('newest first, one page; played wins over officiated; live matches left out', () => {
    expect(h(8).page).toEqual([{ id: id(6), side: 'B', role: 'played' }, { id: id(4), side: 'A', role: 'played' }, { id: id(3), side: null, role: 'officiated' }]);
    expect(h(9).page.map((p: any) => p.id)).toEqual([id(2), id(1)]);
    expect(h(8).total).toBe(5);
  });
  it('counts: completed and not voided only (as before)', () => {
    expect([h(8).played_count, h(8).officiated_count, h(8).voided_count]).toEqual([2, 1, 1]);
  });
  it('search finds a registered team by name; voided can be hidden', () => {
    expect(h(10).page.map((p: any) => p.id)).toEqual([id(6)]);
    expect(h(11).page.map((p: any) => p.id)).not.toContain(id(2));
    expect(h(11).total).toBe(4);
  });
});

describe('audit #90 · the server', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'controllers', 'matches.controller.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function matchHistory('), src.indexOf('// Before migration 150 is on the database'));
  it('asks the database for one page, then loads only that page', () => {
    expect(fn).toMatch(/supabase\.rpc\('match_history_page', \{ p_user: target, p_offset: offset, p_limit: limit/);
    expect(fn).toMatch(/\.from\('matches'\)\.select\('\*'\)\.in\('id', page\.map\(\(p\) => p\.id\)\)/);
    expect(fn).not.toMatch(/selectAll/);
  });
});
