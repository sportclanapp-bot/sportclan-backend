/**
 * N-R4-3 (launch test plan, Round 4, found while fixing F189): Match history's "Played" still
 * counted a casual match with only one real player (you against a typed-in name). The Profile's
 * count never has (SC-283, countsTowardRecord: a casual match counts with ≥ 2 real players; a ranked
 * one always), so the two numbers still differed. Both of Match history's paths now use that rule:
 * the database function (migration 159) and the server's fallback (buildHistory). The match is
 * still listed.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { buildHistory } from '../controllers/matches.controller';

const ROOT = path.join(__dirname, '..', '..');

describe('the server fallback', () => {
  it('a solo casual match is listed, not counted as played; ranked and two-player casual ones are', () => {
    const rows = [
      { id: 'r', status: 'completed', completed_at: '2026-10-01', is_ranked: true, team_a_name: 'Me', team_b_name: 'You', team_a_id: 'P', team_b_id: 'Q' },
      { id: 'two', status: 'completed', completed_at: '2026-10-02', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues' },
      { id: 'solo', status: 'completed', completed_at: '2026-10-03', is_ranked: false, team_a_name: 'Me', team_b_name: 'Street XI' },
    ];
    const sides = new Map([['r', 'A'], ['two', 'A'], ['solo', 'A']]);
    const h = buildHistory(rows, sides, 0, 10, new Map([['r', 1], ['two', 2], ['solo', 1]]));
    expect(h.played_count).toBe(2);
    expect(h.matches.map((x: any) => x.id)).toEqual(['solo', 'two', 'r']);
  });
});

describe('a match that says whose record it counted (attributed_user_ids, since Audit #56)', () => {
  it('the fallback counts it as played only for those people (a player who never agreed is listed, not played)', () => {
    const rows = [
      { id: 'agreed', status: 'completed', completed_at: '2026-10-02', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues', score_summary: { attributed_user_ids: ['me', 'you'] } },
      { id: 'not', status: 'completed', completed_at: '2026-10-03', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues', score_summary: { attributed_user_ids: [] } },
    ];
    const h = buildHistory(rows, new Map([['agreed', 'A'], ['not', 'A']]), 0, 10, new Map([['agreed', 2], ['not', 2]]), 'me');
    expect(h.played_count).toBe(1);
  });
});

describe('migration 159: the database function', () => {
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
  it('Played leaves out a casual match with one real player', () => {
    const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '159_byes_not_played_local_area.sql'), 'utf8');
    // 1: ranked, only me registered · 2: casual, two real players · 3: casual, me vs a typed-in name
    const out = pg([
      `CREATE TABLE teams (id uuid primary key, name text);`,
      `CREATE TABLE users (id uuid primary key);`,
      `CREATE TABLE matches (id uuid primary key, status text, voided_at timestamptz, completed_at timestamptz, updated_at timestamptz, scheduled_at timestamptz, team_a_name text, team_b_name text, team_a_id uuid, team_b_id uuid, umpire_id uuid, tournament_id uuid, is_ranked boolean);`,
      `CREATE TABLE match_participants (match_id uuid, user_id uuid, team_side text);`,
      `INSERT INTO matches VALUES
        ('${id(1)}', 'completed', null, '2026-10-01', null, null, 'Me', 'You', '${id(900)}', '${id(901)}', null, null, true),
        ('${id(2)}', 'completed', null, '2026-10-02', null, null, 'Reds', 'Blues', null, null, null, null, false),
        ('${id(3)}', 'completed', null, '2026-10-03', null, null, 'Me', 'Street XI', null, null, null, null, false);`,
      `INSERT INTO match_participants VALUES ('${id(1)}', '${U}', 'A'), ('${id(2)}', '${U}', 'A'), ('${id(2)}', '${OTHER}', 'B'), ('${id(3)}', '${U}', 'A');`,
      // 4: casual, two players, but the result counted nobody (the other never agreed — Audit #6/#56)
      `ALTER TABLE matches ADD COLUMN score_summary jsonb;`,
      `INSERT INTO matches (id, status, completed_at, team_a_name, team_b_name, is_ranked, score_summary) VALUES ('${id(4)}', 'completed', '2026-10-04', 'Reds', 'Blues', false, '{"attributed_user_ids": []}');`,
      `INSERT INTO match_participants VALUES ('${id(4)}', '${U}', 'A'), ('${id(4)}', '${OTHER}', 'B');`,
      MIG,
      `SELECT match_history_page('${U}', 0, 10) AS h;`,
    ]);
    expect(out.filter((o) => o.error)).toEqual([]);
    const h = out[out.length - 1]!.rows![0].h;
    expect(h.played_count).toBe(2); // 1 and 2 — not the solo match, nor 4 (counted for nobody)
    expect(h.total).toBe(4); // still listed
  });
});
