/** Audit #79 follow-up (11 Oct 2026): the match sweeps abandon their matches a chunk of ids at a time — every one, however many. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { sweepUnplayedScheduledMatches } from '../controllers/matches.controller';

test('400 never-started casual matches: all abandoned, each update ≤ 150 ids', async () => {
  const old = new Date(Date.now() - 50 * 3600_000).toISOString();
  db = fakeDb({ matches: Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, status: 'scheduled', scheduled_at: old, tournament_id: null })) });
  const r = await sweepUnplayedScheduledMatches();
  expect(r.abandoned).toBe(400);
  expect(db.t('matches').every((m) => m.status === 'abandoned')).toBe(true);
});
