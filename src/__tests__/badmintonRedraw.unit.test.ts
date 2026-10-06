/**
 * Badminton 7.13 (Oct 2026) · re-draw: until a match has started the organiser
 * can clear the draw and make it again; everyone entered is told. Byes don't
 * count as started. Sport-neutral.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
const T = id(1); const P = id(2); const ORG = id(9);
const mt = (n: number, extra: object = {}) => ({ id: id(100 + n), tournament_id: T, status: 'scheduled', team_a_id: 'a', team_b_id: 'b', team_a_name: 'Ravi', team_b_name: 'Amit', score_summary: null, voided_at: null, ...extra });
const mkDb = (matches: object[], t: object = {}) => fakeDb({
  tournaments: [{ id: T, name: 'P3 Cup', status: 'live', fixtures_generated: true, created_by: ORG, parent_id: null, settings: { v: 1, seeding: 'random' }, ...t }, { id: P, name: 'Open', is_parent: true, created_by: ORG, fixtures_generated: false, status: 'upcoming' }],
  matches,
  tournament_entries: [{ id: 'e1', tournament_id: T, team_id: 'a', status: 'approved', seed: 1 }, { id: 'e2', tournament_id: T, team_id: 'b', status: 'approved', seed: 2 }],
  team_members: [{ team_id: 'a', user_id: 'u-ravi' }, { team_id: 'b', user_id: 'u-amit' }],
});
let db = mkDb([]);
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ isTournamentOrganiser: jest.fn(async (_t: string, u: string) => u === ORG) }));
jest.mock('../utils/tournamentEvents', () => ({ refreshParentOf: jest.fn(async () => undefined) }));
const sent: Array<{ ids: string[]; title: string }> = [];
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async (ids: string[], n: { title: string }) => { sent.push({ ids, title: n.title }); }) }));

// eslint-disable-next-line import/first
import { redraw, drawStarted } from '../controllers/redraw.controller';

const run = async (userId: string, tid = T) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await redraw({ userId, params: { id: tid }, body: {} } as any, r);
  return r;
};
beforeEach(() => { sent.length = 0; });

test('nothing started: the fixtures go, the draw can be made again, random seeds cleared, everyone told', async () => {
  db = mkDb([mt(1), mt(2, { team_a_id: 'c', team_b_id: null, team_a_name: 'Kiran', team_b_name: 'BYE', status: 'completed', winner_team_id: 'c' }), mt(3, { team_a_id: null, team_b_id: null, team_a_name: 'TBD', team_b_name: 'TBD' })]);
  const r = await run(ORG);
  expect(r.statusCode).toBe(200);
  expect(r.body).toEqual({ removed: 3 });
  expect(db.t('matches')).toHaveLength(0);
  expect(db.t('tournaments')[0]).toMatchObject({ fixtures_generated: false, status: 'upcoming' });
  expect(db.t('tournament_entries').map((e) => e.seed)).toEqual([null, null]);
  expect(sent).toEqual([{ ids: ['u-ravi', 'u-amit'], title: 'New draw coming' }]);
});

test('a match started (live, scored, finished or voided): refused, nothing deleted', async () => {
  for (const extra of [{ status: 'live' }, { score_summary: { A: { score: 3 } } }, { status: 'completed', winner_team_id: 'a' }, { voided_at: '2026-10-01' }]) {
    db = mkDb([mt(1), mt(2, extra)]);
    const r = await run(ORG);
    expect(r.body.code).toBe('DRAW_STARTED');
    expect(db.t('matches')).toHaveLength(2);
    expect(db.t('tournaments')[0].fixtures_generated).toBe(true);
  }
});

test('only the organiser; a draw must exist; a tournament made of events re-draws per event', async () => {
  db = mkDb([mt(1)]);
  expect((await run('u-ravi')).statusCode).toBe(403);
  db = mkDb([], { fixtures_generated: false });
  expect((await run(ORG)).body.code).toBe('NOT_DRAWN');
  expect((await run(ORG, P)).body.code).toBe('REDRAW_AN_EVENT');
  db = mkDb([mt(1)], { status: 'completed' });
  expect((await run(ORG)).body.code).toBe('TOURNAMENT_OVER');
});

test('a Swiss starts its pairing again', async () => {
  db = mkDb([mt(1)], { format: 'swiss', settings: { v: 1, swiss: { rounds: 5, paired: 1 } } });
  await run(ORG);
  expect(db.t('tournaments')[0].settings.swiss).toEqual({ rounds: 5, paired: 0 });
  expect(drawStarted([mt(1, { team_b_id: null, team_b_name: 'BYE', status: 'completed' }) as never])).toBe(false);
});
