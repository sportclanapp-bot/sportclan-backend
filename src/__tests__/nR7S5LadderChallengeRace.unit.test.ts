/**
 * N-R7-S5 (Step 2 · Batch 4, RW-G3-170) · two players challenged the same rung at
 * the same moment and BOTH challenges were made: each request checked "is anyone
 * busy?" before either match existed. One open challenge each is the ladder's
 * rule (ladderBox.ts), so the later of two racing challenges is taken back and
 * refused with the same words a slower second tap gets.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUsers: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { createLadderChallenge } from '../controllers/tournaments.controller';

const run = async (userId: string, body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await createLadderChallenge({ userId, params: { id: 'T' }, query: {}, body } as any, r);
  return r;
};

beforeEach(() => {
  db = fakeDb({
    tournaments: [{ id: 'T', name: 'Ladder', format: 'ladder', status: 'live', fixtures_generated: true, sport_id: 's', created_by: 'org', settings: { ladder: { move: 'leapfrog' } }, entry_kind: 'singles' }],
    tournament_organisers: [],
    sports: [{ id: 's', slug: 'badminton', name: 'Badminton' }],
    tournament_entries: ['A', 'B', 'C', 'D'].map((x, i) => ({ id: `e${x}`, tournament_id: 'T', team_id: x, seed: i + 1, status: 'approved', entered_at: '2026-10-01T00:00:00Z', team: { name: x } })),
    team_members: ['A', 'B', 'C', 'D'].map((x) => ({ team_id: x, user_id: `u${x}`, role: 'captain' })),
    matches: [],
  });
});

describe('N-R7-S5 · two challenges for the same rung at once', () => {
  test('3rd and 4th both challenge 2nd at the same moment: one match, the other refused', async () => {
    const [c, d] = await Promise.all([run('uC', { defender_team_id: 'B' }), run('uD', { defender_team_id: 'B' })]);
    const codes = [c.statusCode, d.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const refused = c.statusCode === 409 ? c : d;
    expect(refused.body).toEqual({ error: 'They have a challenge to play first.', code: 'CHALLENGE' });
    expect(db.t('matches').filter((m: any) => m.tournament_id === 'T')).toHaveLength(1);
  });
  test('one player making two challenges at once (double tap on two rungs) keeps one', async () => {
    const [x, y] = await Promise.all([run('uD', { defender_team_id: 'B' }), run('uD', { defender_team_id: 'C' })]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect((x.statusCode === 409 ? x : y).body.error).toBe('You have a challenge to play first.');
    expect(db.t('matches')).toHaveLength(1);
  });
  test('challenges that don’t share a player both stand', async () => {
    const [x, y] = await Promise.all([run('uB', { defender_team_id: 'A' }), run('uD', { defender_team_id: 'C' })]);
    expect([x.statusCode, y.statusCode]).toEqual([200, 200]);
    expect(db.t('matches')).toHaveLength(2);
  });
});
