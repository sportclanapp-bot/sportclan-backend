/**
 * N-R7-50 (Step 2, Batch 2 R4): the result poster's subtitle is "<tournament> · <when> · <ground>",
 * but GET /matches/:id never sent the tournament's name (only its format), so a fixture's
 * poster read like a friendly's. The match page now carries tournament_name.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { getMatch } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.setHeader = () => r; r.set = () => r; return r; };
const M = '11111111-1111-4111-8111-111111111111';
const view = async (tournament_id: string | null) => {
  db = fakeDb({ sports: [{ id: 's', slug: 'cricket' }], tournaments: [{ id: 'T', format: 'league', name: 'P3 S15 NRR Cup' }], matches: [{ id: M, sport_id: 's', created_by: 'creator', status: 'completed', tournament_id, team_a_id: 'A', team_b_id: 'B', voided_at: null, score_summary: {} }] });
  const r = res();
  await getMatch({ userId: 'viewer', params: { id: M }, query: {}, header: () => undefined, headers: {} } as any, r);
  return r.body?.match ?? r.body;
};

test('a fixture carries its tournament’s name (and format) for the result poster', async () => {
  const m = await view('T');
  expect(m.tournament_name).toBe('P3 S15 NRR Cup');
  expect(m.tournament_format).toBe('league');
});

test('a casual match has no tournament name', async () => {
  const m = await view(null);
  expect(m.tournament_name ?? null).toBeNull();
});
