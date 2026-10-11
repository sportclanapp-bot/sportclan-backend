/** Audit #47 (11 Oct 2026): undo removed only the caller's own last event, so after a scorer hand-over it skipped the real last one. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import * as scoring from '../controllers/scoring.controller';

const M = '11111111-1111-4111-8111-111111111111';
const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };

test('after a hand-over, undo takes back the last event (scored by the previous scorer)', async () => {
  db = fakeDb({
    matches: [{ id: M, status: 'live', sport_id: 's', created_by: 'old', umpire_id: 'new', tournament_id: null, score_summary: {} }],
    sports: [{ id: 's', slug: 'football' }],
    scoring_leases: [{ match_id: M, user_id: 'new', device_id: 'd2', heartbeat_at: new Date().toISOString(), claimed_at: new Date().toISOString() }],
    match_events: [
      { id: 'e1', match_id: M, event_type: 'score', payload: { kind: 'goal', value: 1, team_side: 'A' }, created_by: 'new', created_at: '2026-10-11T10:00:00Z' },
      { id: 'e2', match_id: M, event_type: 'score', payload: { kind: 'goal', value: 1, team_side: 'B' }, created_by: 'old', created_at: '2026-10-11T10:05:00Z' },
    ],
    scoring_edit_log: [],
  });
  const r = res();
  await scoring.undoEvent({ userId: 'new', params: { matchId: M }, header: (h: string) => (h.toLowerCase() === 'x-device-id' ? 'd2' : undefined), headers: { 'x-device-id': 'd2' } } as any, r);
  expect(r.statusCode).toBe(200);
  expect(db.t('match_events').map((e) => e.id)).toEqual(['e1']);
});
