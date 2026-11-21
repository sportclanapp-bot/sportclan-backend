/**
 * Q39 (Dipak, 21 Nov 2026: A) · N-R6-E020: when the last member leaves a team that has played, the
 * team was kept, empty, still listed and joinable (the next joiner a captainless player) and join
 * requests to it waited forever. It is now CLOSED (teams.closed_at, migration 166): nobody can join
 * (by code, request or being added), pending requests are answered, it leaves Discover and search;
 * its page and history stay.
 */
import fs from 'fs';
import path from 'path';
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { refuseClosedTeam, TEAM_CLOSED } from '../utils/teamVisibility';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const CAP = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const WAITER = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const res = () => { const r: any = { statusCode: 200 }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.on = jest.fn(); r.once = jest.fn(); return r; };

beforeEach(() => {
  db = fakeDb({
    teams: [{ id: T, name: 'Zint Closed XI', kind: 'club', is_public: true, join_policy: 'approval', join_code: 'ZCLOSE', deleted_at: null, closed_at: null, sport_id: 's1', created_by: CAP }],
    team_members: [{ id: 'm1', team_id: T, user_id: CAP, role: 'captain', joined_at: '2026-10-01T00:00:00Z' }],
    team_join_requests: [{ id: 'r1', team_id: T, user_id: WAITER, status: 'pending' }],
    matches: [{ id: 'x1', team_a_id: T, team_b_id: 'other', status: 'completed' }],
    tournament_entries: [],
  });
});

test('the last member leaving a team with history closes it and answers the waiting request', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { removeTeamMember } = require('../controllers/teams.controller');
  const r = res();
  await removeTeamMember({ userId: CAP, params: { id: T, userId: CAP }, query: {}, body: {}, headers: {} } as any, r);
  expect(r.body).toMatchObject({ removed: true, team_empty: true, team_closed: true });
  const team = db.tables.teams[0];
  expect(team.closed_at).toEqual(expect.any(String));
  expect(team.deleted_at).toBeNull(); // the page and history stay
  expect(db.tables.team_join_requests[0]).toMatchObject({ status: 'rejected' });
});

test('a closed team refuses joining, asking and adding (409 TEAM_CLOSED); an open one passes', async () => {
  db.tables.teams[0].closed_at = '2026-11-21T10:00:00Z';
  const r = res(); const next = jest.fn();
  await refuseClosedTeam({ params: { id: T } } as any, r, next);
  expect([r.statusCode, r.body]).toEqual([409, TEAM_CLOSED]);
  expect(next).not.toHaveBeenCalled();
  db.tables.teams[0].closed_at = null;
  const r2 = res();
  await refuseClosedTeam({ params: { id: T } } as any, r2, next);
  expect(next).toHaveBeenCalled();
});

test('joining by code is refused too', async () => {
  db.tables.teams[0].closed_at = '2026-11-21T10:00:00Z';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { joinTeamByCode } = require('../controllers/teams.controller');
  const r = res();
  await joinTeamByCode({ userId: WAITER, body: { join_code: 'zclose' }, params: {}, headers: {} } as any, r);
  expect([r.statusCode, r.body.code]).toEqual([409, 'TEAM_CLOSED']);
});

test('the join, request and decide routes carry the guard; Discover and search leave closed teams out', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../routes/teams.routes.ts'), 'utf8');
  for (const r of ["router.post('/:id/members'", "router.post('/:id/join-requests'", "router.patch('/:id/join-requests/:userId'"]) {
    expect(routes.split('\n').find((l) => l.startsWith(r))).toContain('refuseClosedTeam');
  }
  expect(fs.readFileSync(path.join(__dirname, '../controllers/teams.controller.ts'), 'utf8')).toContain("query = query.is('closed_at', null);");
  expect(fs.readFileSync(path.join(__dirname, '../controllers/search.controller.ts'), 'utf8')).toContain(".is('closed_at', null) // Q39");
});
