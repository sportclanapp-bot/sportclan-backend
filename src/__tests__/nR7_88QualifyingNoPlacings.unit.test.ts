/**
 * N-R7-88 (Step 2 Batch 5, SP-TEN-F02): a qualifying draw crowns nobody — its last round's winners are the
 * qualifiers (Q) — but the placings (awards poster, certificates) read one of its last-round matches as a final:
 * "Men's singles qualifying · 🏆 P18 · Runner-up P19". A qualifying draw now has no placings.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { placingsFor } from '../controllers/awards.controller';

const T = '33333333-3333-4333-8333-333333333333';
const m = (id: string, a: string, b: string, no: number) => ({
  id, tournament_id: T, round: 1, match_no: no, group_label: null, bracket: null, third_place: false, voided_at: null,
  team_a_id: a, team_b_id: b, team_a_name: 'P' + a, team_b_name: 'P' + b, winner_team_id: a, status: 'completed', score_summary: {}, overs: null,
});
const seed = () => fakeDb({
  matches: [m('q1', '17', '20', 0), m('q2', '18', '19', 1)],
  team_members: ['17', '18', '19', '20'].map((x) => ({ team_id: x, user_id: 'u' + x, role: 'captain' })),
  users: ['17', '18', '19', '20'].map((x) => ({ id: 'u' + x, name: 'P' + x, username: null, deleted_at: null })),
});

describe('N-R7-88: a qualifying draw has no winner or runner-up', () => {
  it('a qualifying draw (settings.qualifying) → no placings', async () => {
    db = seed();
    const out = await placingsFor({ id: T, format: 'knockout', status: 'completed', sport_id: null, settings: { v: 1, qualifying: { into: 'main', rounds: 1 } } });
    expect(out).toEqual([]);
  });
  it('the same matches as an ordinary knockout still crown a winner (control)', async () => {
    db = seed();
    const out = await placingsFor({ id: T, format: 'knockout', status: 'completed', sport_id: null, settings: { v: 1 } });
    expect(out.map((p) => p.title)).toContain('Winner');
  });
});
