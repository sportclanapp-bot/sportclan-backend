/** Audit #34 (11 Oct 2026): the "MVP tried" in-memory set grew one entry a match for ever. Now the match records it (score_summary.mvp, null when none). */
import fs from 'fs';
import path from 'path';
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { getMatchMVP } from '../controllers/matchFeatures.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };

test('no in-memory set any more', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/matchFeatures.controller.ts'), 'utf8');
  expect(src).not.toMatch(/mvpTried/);
});

test('a match with no MVP is tried once: the answer is kept on the match', async () => {
  db = fakeDb({ matches: [{ id: 'm', status: 'completed', mvp_user_id: null, score_summary: {}, sport_id: 's', team_a_id: null, team_b_id: null, winner_team_id: null }], match_participants: [], match_events: [], sports: [{ id: 's', slug: 'football' }] });
  await getMatchMVP({ params: { id: 'm' } } as any, res());
  expect('mvp' in db.t('matches')[0]!.score_summary).toBe(true);
});
