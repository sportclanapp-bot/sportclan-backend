/**
 * Audit #84 (11 Oct 2026): player of the match was wrong in carrom and the
 * rally sports — in carrom every event added its value (a foul gave the fouler
 * a point; the toss and the buzzer counted), and rally sports added 1 per
 * score event whatever it was worth (a penalty point, a side-out rally).
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { calculateAndSetMVP } from '../controllers/matchFeatures.controller';

const seed = (slug: string, events: Array<[string, object]>) => {
  db = fakeDb({
    sports: [{ id: 's', slug }],
    matches: [{ id: 'm', sport_id: 's', winner_team_id: null, score_summary: {}, status: 'completed' }],
    match_participants: [{ match_id: 'm', user_id: 'asha', team_side: 'A' }, { match_id: 'm', user_id: 'bilal', team_side: 'B' }],
    users: [{ id: 'asha', name: 'Asha' }, { id: 'bilal', name: 'Bilal' }],
    match_events: events.map(([t, p], i) => ({ id: `e${i}`, match_id: 'm', event_type: t, payload: p, created_at: `2026-10-11T10:00:${String(i).padStart(2, '0')}Z` })),
  });
};

test('carrom: fouls, the toss and the buzzer are no points — a board is', async () => {
  seed('carrom', [
    ['score', { team_side: 'A', kind: 'board', value: 3 }],
    ['foul', { team_side: 'B' }], ['foul', { team_side: 'B' }], ['foul', { team_side: 'B' }], ['foul', { team_side: 'B' }],
    ['note', { kind: 'toss', winner: 'B', team_side: 'B' }], ['note', { kind: 'buzzer', team_side: 'B' }],
  ]);
  expect(await calculateAndSetMVP('m')).toBe('asha');
});

test('rally: points at their worth; a penalty point and a side-out rally are not the player’s', async () => {
  seed('pickleball', [
    ['score', { team_side: 'A', kind: 'point', value: 2 }], ['score', { team_side: 'A', kind: 'point', value: 1 }],
    ['score', { team_side: 'B', kind: 'point', value: 1 }], ['score', { team_side: 'B', kind: 'penalty', value: 1 }],
    ['score', { team_side: 'B', kind: 'rally' }], ['score', { team_side: 'B', kind: 'rally' }],
  ]);
  expect(await calculateAndSetMVP('m')).toBe('asha');
});
