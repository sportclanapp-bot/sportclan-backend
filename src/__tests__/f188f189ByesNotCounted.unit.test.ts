/**
 * F188 / F189 (launch test plan): a bye — a tournament round with no opponent,
 * marked won without a game — was counted as a match (and a win) in some places
 * and not in others:
 *   F188  Team insights 1,097 won vs the team page's 1,053 (44 byes).
 *   F189  Match history "Played 13,348" vs the Profile's 13,316 (32 byes).
 * One rule now (isByeMatch, utils/matchCounts.ts; migration 159 in SQL), and
 * every count obeys it: the team page, Team insights, Match history (both the
 * database function and the server's fallback), the 90-day recap and form
 * (countsTowardRecord), and the activity heatmap.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { isByeMatch, countsTowardRecord } from '../utils/matchCounts';
// eslint-disable-next-line import/first
import { computeTeamRecord } from '../utils/teamRecord';
// eslint-disable-next-line import/first
import { getTeamInsights } from '../controllers/advancedStats.controller';
// eslint-disable-next-line import/first
import { buildHistory } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { getActivityHeatmap } from '../controllers/users.controller';

const ROOT = path.join(__dirname, '..', '..');
const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const TOUR = '33333333-3333-4333-8333-333333333333';
const call = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: ME, params: {}, query: {}, body: {}, ...req } as any, r);
  return r;
};

// A knockout bye is ranked (SC-251) and has the one player's participant row.
const knockoutBye: any = { status: 'completed', is_ranked: true, voided_at: null, tournament_id: TOUR, team_a_id: T, team_b_id: null, team_a_name: 'Lions', team_b_name: 'BYE' };
const swissBye: any = { ...knockoutBye, is_ranked: false };
const casualVsTyped: any = { status: 'completed', is_ranked: false, voided_at: null, tournament_id: null, team_a_id: T, team_b_id: null, team_a_name: 'Lions', team_b_name: 'Street XI' };

describe('the rule', () => {
  it('a bye is a tournament round with one side empty (or named BYE)', () => {
    expect(isByeMatch(knockoutBye)).toBe(true);
    expect(isByeMatch(swissBye)).toBe(true);
    expect(isByeMatch({ ...knockoutBye, tournament_id: undefined })).toBe(true); // by the name
    expect(isByeMatch(casualVsTyped)).toBe(false); // a typed-in opponent is a real game
    expect(isByeMatch({ ...knockoutBye, team_b_id: 'X', team_b_name: 'Tigers' })).toBe(false);
  });
  it('a bye is not in a record (the 90-day recap and form use this)', () => {
    expect(countsTowardRecord(knockoutBye, 1)).toBe(false);
    expect(countsTowardRecord(casualVsTyped, 2)).toBe(true);
    expect(countsTowardRecord({ ...knockoutBye, team_b_id: 'X', team_b_name: 'Tigers' }, 2)).toBe(true);
  });
});

describe('F188 · Team insights agrees with the team page', () => {
  const m = (id: string, b: string | null, w: string | null, status = 'completed') => ({
    id, team_a_id: T, team_b_id: b, team_a_name: 'Lions', team_b_name: b ? 'Rivals' : 'BYE', tournament_id: TOUR,
    winner_team_id: w, status, voided_at: null, scheduled_at: `2026-10-${id.padStart(2, '0')}T10:00:00Z`,
  });
  const seed = () => fakeDb({
    teams: [{ id: T, name: 'Lions', sport_id: 's' }],
    team_members: [{ team_id: T, user_id: ME, role: 'member' }],
    matches: [m('1', 'X', T), m('2', 'X', 'X'), m('3', null, T), m('4', null, T), m('5', 'Y', T, 'abandoned')],
  });
  it('byes are not wins or matches; the record is the team page’s', async () => {
    db = seed();
    const page = await computeTeamRecord(T);
    db = seed();
    const r = await call(getTeamInsights, { params: { id: T } });
    expect(r.statusCode).toBe(200);
    expect(r.body.played).toBe(3);
    expect(r.body.record).toEqual({ wins: 2, losses: 1, draws: 0, winRate: 67 });
    expect([r.body.played, r.body.record.wins, r.body.record.losses]).toEqual([page.played, page.wins, page.losses]);
    // The form dots are matches too — no bye among them.
    expect(r.body.recentForm.map((f: any) => f.opponent)).not.toContain('BYE');
    expect(r.body.recentForm).toHaveLength(3);
  });
});

describe('F189 · Match history counts what the Profile counts', () => {
  it('the server fallback: a bye is listed, not counted as played', () => {
    const rows = [
      { id: 'a', status: 'completed', completed_at: '2026-10-01', team_a_id: 'P', team_b_id: 'Q', tournament_id: TOUR, team_a_name: 'Me', team_b_name: 'You' },
      { id: 'b', status: 'completed', completed_at: '2026-10-02', team_a_id: 'P', team_b_id: null, tournament_id: TOUR, team_a_name: 'Me', team_b_name: 'BYE' },
      { id: 'c', status: 'completed', completed_at: '2026-10-03', team_a_id: null, team_b_id: null, tournament_id: null, team_a_name: 'Reds', team_b_name: 'Blues' },
    ];
    const h = buildHistory(rows, new Map([['a', 'A'], ['b', 'A'], ['c', 'B']]), 0, 10);
    expect(h.played_count).toBe(2);
    expect(h.matches.map((x: any) => x.id)).toEqual(['c', 'b', 'a']);
  });

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
  const file = path.join(ROOT, 'supabase', 'migrations', '159_byes_not_played_local_area.sql');
  it('migration 159: the database function leaves byes out of Played', () => {
    expect(fs.existsSync(file)).toBe(true);
    const MIG = fs.readFileSync(file, 'utf8');
    // 1: a real tournament game · 2: a knockout bye · 3: a Swiss bye (named) · 4: casual vs a typed-in name · 5: casual, no teams
    const out = pg([
      `CREATE TABLE teams (id uuid primary key, name text);`,
      `CREATE TABLE users (id uuid primary key);`, // the file's second part (F038) adds a column to it
      `CREATE TABLE matches (id uuid primary key, status text, voided_at timestamptz, completed_at timestamptz, updated_at timestamptz, scheduled_at timestamptz, team_a_name text, team_b_name text, team_a_id uuid, team_b_id uuid, umpire_id uuid, tournament_id uuid);`,
      `CREATE TABLE match_participants (match_id uuid, user_id uuid, team_side text);`,
      `INSERT INTO matches VALUES
        ('${id(1)}', 'completed', null, '2026-10-01', null, null, 'Me', 'You', '${id(900)}', '${id(901)}', null, '${TOUR}'),
        ('${id(2)}', 'completed', null, '2026-10-02', null, null, 'Me', 'BYE', '${id(900)}', null, null, '${TOUR}'),
        ('${id(3)}', 'completed', null, '2026-10-03', null, null, 'Me', 'BYE', '${id(900)}', null, null, null),
        ('${id(4)}', 'completed', null, '2026-10-04', null, null, 'Me', 'Street XI', '${id(900)}', null, null, null),
        ('${id(5)}', 'completed', null, '2026-10-05', null, null, 'Reds', 'Blues', null, null, null, null);`,
      `INSERT INTO match_participants VALUES ${[1, 2, 3, 4, 5].map((n) => `('${id(n)}', '${U}', 'A')`).join(', ')};`,
      MIG, MIG, // safe to run twice
      `SELECT match_history_page('${U}', 0, 10) AS h;`,
    ]);
    expect(out.filter((o) => o.error)).toEqual([]);
    const h = out[8]!.rows![0].h;
    expect(h.played_count).toBe(3); // 1, 4, 5 — not the byes
    expect(h.total).toBe(5); // still listed
  });
});

describe('the heatmap: a bye is not a day played', () => {
  it('only the real game is in the cell', async () => {
    const today = new Date().toISOString();
    db = fakeDb({
      users: [{ id: ME }],
      match_participants: [
        { user_id: ME, team_side: 'A', match: { id: 'g', status: 'completed', completed_at: today, team_a_id: T, team_b_id: 'X', tournament_id: TOUR, winner_team_id: T, voided_at: null } },
        { user_id: ME, team_side: 'A', match: { id: 'b', status: 'completed', completed_at: today, team_a_id: T, team_b_id: null, team_b_name: 'BYE', tournament_id: TOUR, winner_team_id: T, voided_at: null } },
      ],
    });
    const r = await call(getActivityHeatmap, { params: { id: ME } });
    const cells = (r.body.heatmap as Array<{ matches: number; wins: number }>).filter((c) => c.matches > 0);
    expect(cells).toEqual([expect.objectContaining({ matches: 1, wins: 1 })]);
  });
});
