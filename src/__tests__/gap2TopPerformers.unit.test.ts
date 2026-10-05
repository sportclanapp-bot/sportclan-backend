/**
 * Cricket gap 2 (5 Oct 2026) · GET /tournaments/:id/top-performers. It sent
 * only { topWins } while the app's type read { performers }. Now: topWins as
 * before (older apps), performers (flat) and leaders (by stat) for cricket.
 */
type Row = Record<string, any>;
const db: Record<string, Row[]> = { tournaments: [], matches: [], teams: [], innings_stats: [], users: [] };
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let head = false;
    const run = () => {
      const rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of rows) Object.assign(r, patch);
      return rows;
    };
    const q: any = {
      select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; },
      update: (p: Row) => { patch = p; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: null) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      not: (c: string, _op: string, v: null) => { filters.push((r) => (r[c] ?? null) !== v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => { const rows = run(); return resolve({ data: head ? null : rows, count: rows.length, error: null }); },
    };
    return q;
  };
  return { supabase: { from } };
});
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []) }));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn() }));

let mockSlug = 'cricket';
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: mockSlug })), normSportSlug: (s: string) => s }));

// eslint-disable-next-line import/first
import fs from 'fs';
// eslint-disable-next-line import/first
import path from 'path';
// eslint-disable-next-line import/first
import { getTournamentTopPerformers } from '../controllers/features.controller';

const call = async () => {
  const res: any = { statusCode: 200, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  await getTournamentTopPerformers({ params: { id: 't1' }, userId: 'me' } as any, res);
  return res;
};
const match = (id: string, extra: Row) => ({ id, tournament_id: 't1', team_a_id: 'tA', team_b_id: 'tB', winner_team_id: 'tA', status: 'completed', voided_at: null, ...extra });

beforeEach(() => {
  mockSlug = 'cricket';
  db.tournaments = [{ id: 't1', sport_id: 's1' }];
  db.teams = [{ id: 'tA', name: 'Sunrisers' }, { id: 'tB', name: 'Royals' }];
  db.users = [{ id: 'gone', deleted_at: '2026-10-01T00:00:00Z' }];
  db.matches = [
    match('m1', { players: { u1: { name: 'Ravi', side: 'A', runs: 50, balls: 30, bowl_balls: 6, bowl_runs: 8, bowl_wickets: 2 }, gone: { name: 'Gone', side: 'B', runs: 90 } } }),
    match('m2', { players: null }), // older: innings_stats
    match('m3', { voided_at: '2026-10-02T00:00:00Z', players: { u1: { name: 'Ravi', side: 'A', runs: 500 } } }),
    match('m4', { status: 'scheduled', winner_team_id: null, players: { u1: { name: 'Ravi', side: 'A', runs: 500 } } }),
  ];
  db.innings_stats = [{ match_id: 'm2', user_id: 'u2', team_id: 'tB', runs: 40, balls_faced: 20, sixes: 3, is_out: true, bowling_overs: 0, bowling_runs: 0, bowling_wickets: 0, catches: 1, runouts: 0, stumpings: 0, user: { name: 'Kiran' } }];
});

test('a cricket tournament: topWins as before, performers in the app’s shape, leaders by stat', async () => {
  const r = await call();
  expect(r.statusCode).toBe(200);
  expect(r.body.topWins).toEqual([{ teamId: 'tA', teamName: 'Sunrisers', wins: 2 }]);
  expect(r.body.leaders.runs.map((x: any) => [x.name, x.value, x.team_name])).toEqual([['Ravi', 50, 'Sunrisers'], ['Kiran', 40, 'Royals']]);
  expect(r.body.leaders.best_bowling[0]).toMatchObject({ name: 'Ravi', detail: '2/8' });
  for (const p of r.body.performers) expect(Object.keys(p)).toEqual(expect.arrayContaining(['user_id', 'name', 'stat', 'value']));
  expect(r.body.performers.filter((p: any) => p.stat === 'runs').map((p: any) => p.name)).toEqual(['Ravi', 'Kiran']);
  // A voided or unplayed fixture counts for nothing; a deleted account isn't listed.
  expect(JSON.stringify(r.body)).not.toContain('Gone');
  expect(r.body.leaders.runs[0].value).toBe(50);
});
test('another sport: topWins, and no player boards', async () => {
  mockSlug = 'football';
  const r = await call();
  expect(r.body).toEqual({ topWins: [{ teamId: 'tA', teamName: 'Sunrisers', wins: 2 }], performers: [], leaders: null });
});
test('an unknown tournament is 404', async () => {
  db.tournaments = [];
  expect((await call()).statusCode).toBe(404);
});
test('reads only the rollup out of each summary', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'features.controller.ts'), 'utf8');
  expect(s).toContain("'id, team_a_id, team_b_id, winner_team_id, status, players:score_summary->players'");
});
