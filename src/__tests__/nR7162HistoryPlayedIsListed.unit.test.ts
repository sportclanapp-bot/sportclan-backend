/**
 * N-R7-162 (Step 2, Batch 8, OBS-A5-1): Match history's header said "Played 2" over a list of 109
 * finished games. Since N-R4-3 Played counted only the games on the person's record (the result's
 * attributed_user_ids, else ranked or two or more real players); the list shows every game they
 * played. Played is now every finished game the list shows as played (not voided, not a bye), in
 * the server's fallback (buildHistory) and the database function (migration 162); the record's
 * number is counted_count.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { buildHistory } from '../controllers/matches.controller';

const ROOT = path.join(__dirname, '..', '..');

describe('the server fallback', () => {
  it('Played is every finished game listed as played; counted_count is the record', () => {
    const rows = [
      { id: 'agreed', status: 'completed', completed_at: '2026-10-01', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues', score_summary: { attributed_user_ids: ['me', 'you'] } },
      { id: 'notme', status: 'completed', completed_at: '2026-10-02', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues', score_summary: { attributed_user_ids: ['you'] } },
      { id: 'solo', status: 'completed', completed_at: '2026-10-03', is_ranked: false, team_a_name: 'Me', team_b_name: 'Street XI' },
      { id: 'void', status: 'completed', completed_at: '2026-10-04', voided_at: '2026-10-05', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues' },
      { id: 'bye', status: 'completed', completed_at: '2026-10-06', is_ranked: true, team_a_id: 'T', team_a_name: 'Me', team_b_name: null, tournament_id: 'X' },
      { id: 'abandoned', status: 'abandoned', completed_at: '2026-10-07', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues' },
    ];
    const sides = new Map(rows.map((r) => [r.id, 'A']));
    const h: any = buildHistory(rows, sides, 0, 10, new Map([['agreed', 2], ['notme', 2], ['solo', 1], ['void', 2], ['bye', 1], ['abandoned', 2]]), 'me');
    expect(h.played_count).toBe(3); // agreed, notme, solo — every finished game listed (not the voided one, the bye, the abandoned one)
    expect(h.counted_count).toBe(1); // only 'agreed' is on my record
    expect(h.matches).toHaveLength(6); // all still listed
  });
});

describe('migration 162: the database function', () => {
  const RUNNER = `
import { PGlite } from '@electric-sql/pglite';
let s = ''; for await (const c of process.stdin) s += c;
const db = new PGlite(); const out = [];
for (const q of JSON.parse(s)) {
  try { const r = await db.exec(q); out.push({ rows: r.length ? r[r.length - 1].rows : [] }); }
  catch (e) { out.push({ error: e.message }); }
}
console.log('@@' + JSON.stringify(out));`;
  const pg = (steps: string[]): Array<{ rows?: any[]; error?: string }> => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER], { cwd: ROOT, input: JSON.stringify(steps), encoding: 'utf8', timeout: 120000 });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
    if (!line) throw new Error(`PGlite runner failed: ${r.stderr}`);
    return JSON.parse(line.slice(2));
  };
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const U = id(1000);
  const OTHER = id(1001);
  it('Played counts every finished game listed; counted_count the record', () => {
    const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '162_history_played_is_listed.sql'), 'utf8');
    const out = pg([
      `CREATE TABLE teams (id uuid primary key, name text);`,
      `CREATE TABLE matches (id uuid primary key, status text, voided_at timestamptz, completed_at timestamptz, updated_at timestamptz, scheduled_at timestamptz, team_a_name text, team_b_name text, team_a_id uuid, team_b_id uuid, umpire_id uuid, tournament_id uuid, is_ranked boolean, score_summary jsonb);`,
      `CREATE TABLE match_participants (match_id uuid, user_id uuid, team_side text);`,
      // 1: ranked · 2: casual, two players · 3: me vs a typed-in name · 4: two players, counted for nobody · 5: a bye
      `INSERT INTO matches VALUES
        ('${id(1)}', 'completed', null, '2026-10-01', null, null, 'Me', 'You', '${id(900)}', '${id(901)}', null, null, true, null),
        ('${id(2)}', 'completed', null, '2026-10-02', null, null, 'Reds', 'Blues', null, null, null, null, false, null),
        ('${id(3)}', 'completed', null, '2026-10-03', null, null, 'Me', 'Street XI', null, null, null, null, false, null),
        ('${id(4)}', 'completed', null, '2026-10-04', null, null, 'Reds', 'Blues', null, null, null, null, false, '{"attributed_user_ids": []}'),
        ('${id(5)}', 'completed', null, '2026-10-05', null, null, 'Me', null, '${id(900)}', null, null, '${id(950)}', true, null);`,
      `INSERT INTO match_participants VALUES ('${id(1)}', '${U}', 'A'), ('${id(2)}', '${U}', 'A'), ('${id(2)}', '${OTHER}', 'B'), ('${id(3)}', '${U}', 'A'), ('${id(4)}', '${U}', 'A'), ('${id(4)}', '${OTHER}', 'B'), ('${id(5)}', '${U}', 'A');`,
      MIG,
      `SELECT match_history_page('${U}', 0, 10) AS h;`,
    ]);
    expect(out.filter((o) => o.error)).toEqual([]);
    const h = out[out.length - 1]!.rows![0].h;
    expect(h.played_count).toBe(4); // 1–4, not the bye
    expect(h.counted_count).toBe(2); // 1 and 2
    expect(h.total).toBe(5);
  });
});
