/**
 * N-R7-S57 (Step 2 Batch 15, RW-G3-008) · two officials voiding the same match at the same moment
 * both passed the 'already voided?' check, so the records were walked back twice (a loser's rating
 * 1184 → 1216 instead of 1200), both answers said 'N player records corrected' and everyone got two
 * 'Match voided' notices. The void now claims the match first (a conditional write on voided_at):
 * only the request that flips it walks the records back; the other answers already_voided. A restore
 * is claimed the same way, so two restores re-apply the records once.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const mockNotify = jest.fn(async () => undefined);
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: (...a: unknown[]) => (mockNotify as any)(...a), matchAudienceIds: jest.fn(async () => ['org', 'p1', 'p2']) }));
// eslint-disable-next-line import/first
import { voidMatch, unvoidMatch } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const M = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  mockNotify.mockClear();
  db = fakeDb({
    sports: [{ id: 's', slug: 'football' }],
    matches: [{ id: M, sport_id: 's', tournament_id: null, created_by: 'org', umpire_id: 'ump', status: 'completed', is_ranked: true, completed_at: new Date().toISOString(), voided_at: null, team_a_id: 'A', team_b_id: 'B', team_a_name: 'A', team_b_name: 'B', winner_team_id: 'A', score_summary: { attributed_user_ids: ['p1', 'p2'] } }],
    match_participants: [{ match_id: M, user_id: 'p1', team_side: 'A' }, { match_id: M, user_id: 'p2', team_side: 'B' }],
    rating_history: [{ match_id: M, user_id: 'p1', delta: 16 }, { match_id: M, user_id: 'p2', delta: -16 }],
    user_sport_profiles: [
      { user_id: 'p1', sport_id: 's', rating: 1216, matches_played: 1, wins: 1, losses: 0, draws: 0 },
      { user_id: 'p2', sport_id: 's', rating: 1184, matches_played: 1, wins: 0, losses: 1, draws: 0 },
    ],
    users: [{ id: 'org', name: 'Org' }, { id: 'ump', name: 'Ump' }],
  });
});
const prof = (u: string) => db.t('user_sport_profiles').find((p: any) => p.user_id === u)!;

test('two voids at once walk the records back once; the second says already_voided', async () => {
  const a = res(); const b = res();
  await Promise.all([
    voidMatch({ userId: 'org', params: { id: M }, body: { reason: 'Wrong result' } } as any, a),
    voidMatch({ userId: 'ump', params: { id: M }, body: { reason: 'Scored in error' } } as any, b),
  ]);
  expect([prof('p1').rating, prof('p1').matches_played, prof('p2').rating, prof('p2').losses].map(Number)).toEqual([1200, 0, 1200, 0]);
  expect([a.body.already_voided, b.body.already_voided].filter(Boolean)).toHaveLength(1);
  expect(mockNotify).toHaveBeenCalledTimes(1);
});
test('two restores at once re-apply the records once', async () => {
  await voidMatch({ userId: 'org', params: { id: M }, body: { reason: 'Wrong result' } } as any, res());
  const a = res(); const b = res();
  await Promise.all([unvoidMatch({ userId: 'org', params: { id: M } } as any, a), unvoidMatch({ userId: 'ump', params: { id: M } } as any, b)]);
  expect([prof('p1').rating, prof('p1').matches_played, prof('p2').rating, prof('p2').losses].map(Number)).toEqual([1216, 1, 1184, 1]);
  expect([a.body.already_active, b.body.already_active].filter(Boolean)).toHaveLength(1);
});
test('a plain void and a plain restore still work', async () => {
  const v = res(); await voidMatch({ userId: 'org', params: { id: M }, body: { reason: 'Wrong result' } } as any, v);
  expect([v.statusCode, v.body.reversed_players]).toEqual([200, 2]);
  expect(Number(prof('p2').rating)).toBe(1200);
  const u = res(); await unvoidMatch({ userId: 'org', params: { id: M } } as any, u);
  expect([u.statusCode, u.body.restored_players]).toEqual([200, 2]);
  expect(Number(prof('p2').rating)).toBe(1184);
});
