/**
 * Q40 (Dipak, 21 Nov 2026: A) · N-R6-E109: a tournament umpire removed by the organiser kept the
 * umpire seat of the fixtures they took or were given, so they could still score, toss and complete
 * them. Now they come off every unfinished fixture (scheduled or live) of the tournament and its
 * events; finished ones keep who officiated; someone who still holds another official role keeps them.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/softDelete', () => ({
  deleteMatching: jest.fn(async (table: string, narrow: (q: any) => any) => {
    // a stand-in for the archive: drop the matching rows from the fake table
    const { supabase } = jest.requireMock('../utils/supabase');
    const { data } = await narrow(supabase.from(table).select('id'));
    const ids = new Set((data ?? []).map((r: any) => r.id));
    db.tables[table] = db.tables[table].filter((r: any) => !ids.has(r.id));
    return { ids: [...ids], error: null };
  }),
}));
// eslint-disable-next-line import/first
import { removeTournamentOfficial } from '../controllers/features.controller';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'; const EV = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'; const UMP = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002'; const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003';
const res = () => { const r: any = { statusCode: 200 }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const m = (id: string, status: string, tid = T, umpire_id: string | null = UMP, scorer_id: string | null = null) => ({ id, tournament_id: tid, status, umpire_id, scorer_id });

beforeEach(() => {
  db = fakeDb({
    tournaments: [{ id: T, parent_id: null, created_by: ORG }, { id: EV, parent_id: T, created_by: ORG }],
    tournament_officials: [{ id: 'o1', tournament_id: T, user_id: UMP, role: 'umpire' }],
    tournament_organisers: [],
    matches: [m('m1', 'scheduled'), m('m2', 'live'), m('m3', 'completed'), m('m4', 'scheduled', EV, null, UMP), m('m5', 'scheduled', T, OTHER)],
  });
});

test('the organiser removes the umpire → off every unfinished fixture (events too), finished ones kept', async () => {
  const r = res();
  await removeTournamentOfficial({ userId: ORG, params: { id: T, officialId: 'o1' } } as any, r);
  expect(r.body).toEqual({ success: true, fixtures_cleared: 3 });
  const byId = Object.fromEntries(db.tables.matches.map((x: any) => [x.id, x]));
  expect([byId.m1.umpire_id, byId.m2.umpire_id, byId.m4.scorer_id]).toEqual([null, null, null]);
  expect(byId.m3.umpire_id).toBe(UMP); // finished: the record keeps who umpired
  expect(byId.m5.umpire_id).toBe(OTHER);
});

test('someone who still holds another official role in the tournament keeps their seats', async () => {
  db.tables.tournament_officials.push({ id: 'o2', tournament_id: T, user_id: UMP, role: 'scorer' });
  const r = res();
  await removeTournamentOfficial({ userId: ORG, params: { id: T, officialId: 'o1' } } as any, r);
  expect(r.body).toEqual({ success: true, fixtures_cleared: 0 });
  expect(db.tables.matches.find((x: any) => x.id === 'm1')?.umpire_id).toBe(UMP);
});
