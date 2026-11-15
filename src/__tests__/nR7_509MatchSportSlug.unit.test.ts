/**
 * N-R7-509 (Step 2 · Batch 15, SIDE-C7x-2): on a fresh install whose GET /sports failed, the app could not
 * tell a match's sport from its sport_id and drew a live football match as cricket ('A batting 0/0').
 * GET /matches/:id now carries the sport's slug beside its id, so the match page knows its own sport.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { getMatch } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.setHeader = () => r; r.set = () => r; return r; };
const M = '11111111-1111-4111-8111-111111111509';
const view = async (sport_id: string | null) => {
  db = fakeDb({ sports: [{ id: 'sp-football-509', slug: 'football' }], matches: [{ id: M, sport_id, created_by: 'creator', status: 'live', tournament_id: null, team_a_id: 'A', team_b_id: 'B', voided_at: null, score_summary: { A: { score: 1 }, B: { score: 0 } } }] });
  const r = res();
  await getMatch({ userId: 'viewer', params: { id: M }, query: {}, header: () => undefined, headers: {} } as any, r);
  return r.body?.match ?? r.body;
};

test('a match carries its sport’s slug', async () => {
  const m = await view('sp-football-509');
  expect(m.sport_slug).toBe('football');
});

test('an unknown sport id gives no slug (never a guess)', async () => {
  const m = await view('sp-missing-509');
  expect(m.sport_slug ?? null).toBeNull();
});
