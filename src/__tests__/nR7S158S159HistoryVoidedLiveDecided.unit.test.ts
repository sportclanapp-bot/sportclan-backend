/**
 * Step 2 Batch 14 (13 Nov 2026), match history (migration 164 + the server's fallback):
 * N-R7-S158 (REG-091): a match voided while live keeps status 'live' (with voided_at); the history
 *   took only completed / abandoned matches, so it vanished ('Played 0', 'No matches played yet').
 *   It is now listed (VOIDED) and still counts nowhere.
 * N-R7-S159 (SIDE-C8-1): 'on the record' (counted_count) is the Profile's count, but it counted a
 *   match decided by an organiser ('result stands' / 'awarded') or a walkover, which change nobody's
 *   record (matchVoid.recordDeltas). Those are left out of counted_count.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { buildHistory } from '../controllers/matches.controller';
import { countsForUser } from '../utils/matchCounts';

const ROOT = path.join(__dirname, '..', '..');

describe('N-R7-S159: a decided match or a walkover is on nobody’s record', () => {
  it('countsForUser leaves them out; a played result still counts', () => {
    const base = { status: 'completed', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues' };
    expect(countsForUser({ ...base, score_summary: { winner_side: 'A' } }, 'me', 4)).toBe(true);
    expect(countsForUser({ ...base, score_summary: { decision: { kind: 'stands' } } }, 'me', 4)).toBe(false);
    expect(countsForUser({ ...base, score_summary: { decision: { kind: 'awarded' }, walkover: true } }, 'me', 4)).toBe(false);
    expect(countsForUser({ ...base, score_summary: { walkover: true } }, 'me', 4)).toBe(false);
    expect(countsForUser({ ...base, score_summary: { decision: { kind: 'replay' }, attributed_user_ids: ['me'] } }, 'me', 4)).toBe(true);
  });
  it('the fallback history: Played lists them, counted_count does not', () => {
    const rows = [
      { id: 'played', status: 'completed', completed_at: '2026-10-01', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues', score_summary: { attributed_user_ids: ['me', 'you'] } },
      { id: 'stands', status: 'completed', completed_at: '2026-10-02', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues', score_summary: { decision: { kind: 'stands' } } },
      { id: 'voidlive', status: 'live', voided_at: '2026-10-03', is_ranked: false, team_a_name: 'Reds', team_b_name: 'Blues' },
    ];
    const h: any = buildHistory(rows, new Map(rows.map((r) => [r.id, 'A'])), 0, 10, new Map([['played', 2], ['stands', 2], ['voidlive', 2]]), 'me');
    expect(h.played_count).toBe(2);
    expect(h.counted_count).toBe(1);
    expect(h.matches.map((m: any) => m.id)).toContain('voidlive');
  });
});

describe('migration 164: the database function', () => {
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
  it('lists a match voided while live; leaves decided matches and walkovers off the record', () => {
    const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '164_history_voided_live_and_decided.sql'), 'utf8');
    const out = pg([
      `CREATE TABLE teams (id uuid primary key, name text);`,
      `CREATE TABLE matches (id uuid primary key, status text, voided_at timestamptz, completed_at timestamptz, updated_at timestamptz, scheduled_at timestamptz, team_a_name text, team_b_name text, team_a_id uuid, team_b_id uuid, umpire_id uuid, tournament_id uuid, is_ranked boolean, score_summary jsonb);`,
      `CREATE TABLE match_participants (match_id uuid, user_id uuid, team_side text);`,
      // 1: played · 2: 'result stands' · 3: awarded (a walkover) · 4: voided while live · 5: a live match (not history)
      `INSERT INTO matches VALUES
        ('${id(1)}', 'completed', null, '2026-10-01', null, null, 'Reds', 'Blues', null, null, null, null, false, null),
        ('${id(2)}', 'completed', null, '2026-10-02', null, null, 'Reds', 'Blues', null, null, null, null, false, '{"decision": {"kind": "stands"}}'),
        ('${id(3)}', 'completed', null, '2026-10-03', null, null, 'Reds', 'Blues', null, null, null, null, false, '{"decision": {"kind": "awarded"}, "walkover": true}'),
        ('${id(4)}', 'live', '2026-10-04', null, '2026-10-04', null, 'Reds', 'Blues', null, null, null, null, false, null),
        ('${id(5)}', 'live', null, null, '2026-10-05', null, 'Reds', 'Blues', null, null, null, null, false, null);`,
      `INSERT INTO match_participants SELECT m, '${U}'::uuid, 'A' FROM unnest(ARRAY['${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(5)}']::uuid[]) m UNION ALL SELECT m, '${OTHER}'::uuid, 'B' FROM unnest(ARRAY['${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(5)}']::uuid[]) m;`,
      MIG,
      `SELECT match_history_page('${U}', 0, 10) AS h;`,
      `SELECT match_history_page('${U}', 0, 10, NULL, true) AS h;`,
    ]);
    expect(out.filter((o) => o.error)).toEqual([]);
    const h = out[out.length - 2]!.rows![0].h;
    expect(h.total).toBe(4); // 1–4: the voided-while-live match is listed; the live one is not
    expect(h.page.map((p: any) => p.id)).toContain(id(4));
    expect(h.voided_count).toBe(1);
    expect(h.played_count).toBe(3); // 1, 2, 3 (finished, not voided)
    expect(h.counted_count).toBe(1); // only 1 is on the record
    expect(out[out.length - 1]!.rows![0].h.total).toBe(3); // voided hidden
  });
});
