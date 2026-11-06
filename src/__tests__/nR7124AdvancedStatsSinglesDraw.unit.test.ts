/**
 * N-R7-124 (Step 2, Batch 8 · SP-CHS-C27): Advanced Stats counted a drawn casual ranked chess
 * game (singles, no team ids) as a win or a loss. matchResult() fell back to the rating
 * delta's sign, and a draw between unequal ratings still moves both ratings. Teamless matches
 * now read the stored result first, the same signals the profile and insights use:
 * score_summary.winner_side (W/L by my side) and result_type 'draw' (D); the delta sign is
 * only the last resort when neither is stored.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => 's') }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ id: 's', slug: 'chess' })) }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), isBlockedBetween: jest.fn(async () => false) }));
// eslint-disable-next-line import/first
import { getAdvancedStats } from '../controllers/advancedStats.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const OPP = '22222222-2222-4222-8222-222222222222';
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

type G = { delta: number; mySide: 'A' | 'B'; winner_side: 'A' | 'B' | null; result_type: string | null };
async function run(games: G[]) {
  let r0 = 1500;
  const matches = games.map((g, i) => ({ id: uuid(i + 1), team_a_id: null, team_b_id: null, team_a_name: null, team_b_name: null, winner_team_id: null,
    winner_side: g.winner_side, result_type: g.result_type, scheduled_at: '2026-11-05T10:00:00Z', format: 'singles', city_id: null, voided_at: null }));
  const rating_history = games.map((g, i) => { const old = r0; r0 = +(r0 + g.delta).toFixed(2);
    return { id: uuid(5000 + i), user_id: ME, sport_id: 's', match_id: matches[i]!.id, old_rating: old, new_rating: r0, delta: g.delta,
      created_at: new Date(Date.UTC(2026, 10, 5, 10, i)).toISOString(), match: { id: matches[i]!.id, voided_at: null } }; });
  db = fakeDb({ users: [{ id: ME, deleted_at: null, name: 'Me' }, { id: OPP, deleted_at: null, name: 'Opp' }], rating_history,
    user_sport_profiles: [{ user_id: ME, sport_id: 's', rating: r0 }], matches,
    match_participants: games.flatMap((g, i) => [{ match_id: matches[i]!.id, user_id: ME, team_side: g.mySide },
      { match_id: matches[i]!.id, user_id: OPP, team_side: g.mySide === 'A' ? 'B' : 'A' }]) });
  const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.setHeader = () => r; r.set = () => r;
  await getAdvancedStats({ userId: ME, params: {}, query: { sport_id: 'chess' }, header: () => undefined, headers: {} } as any, r);
  expect(r.statusCode).toBe(200);
  return r.body;
}

test('SP-CHS-C27: 3 wins, 1 loss and 2 drawn singles games that moved the rating read W3 L1 D2', async () => {
  const b = await run([
    { delta: 12, mySide: 'A', winner_side: 'A', result_type: 'decisive' },
    { delta: 9, mySide: 'B', winner_side: 'B', result_type: 'decisive' },
    { delta: -6, mySide: 'A', winner_side: null, result_type: 'draw' }, // a draw against a lower-rated player
    { delta: -15, mySide: 'A', winner_side: 'B', result_type: 'decisive' },
    { delta: 4, mySide: 'B', winner_side: null, result_type: 'draw' }, // a draw against a higher-rated player
    { delta: 10, mySide: 'A', winner_side: 'A', result_type: 'decisive' },
  ]);
  expect(b.form.last10.map((d: any) => d.result).join('')).toBe('WWDLDW');
  expect([b.form.wins, b.form.losses, b.form.draws]).toEqual([3, 1, 2]);
  expect(b.form.winRate).toBe(50); // 3 of 6
  expect(b.form.streak).toEqual({ type: 'W', length: 1 });
  const h = b.headToHead.opponents.find((x: any) => x.name === 'Opp');
  expect(h).toMatchObject({ w: 3, l: 1, d: 2 });
});

test('no stored result at all: the delta sign is still the fallback', async () => {
  const b = await run(Array.from({ length: 5 }, (_, i) => ({ delta: i % 2 ? -5 : 5, mySide: 'A' as const, winner_side: null, result_type: null })));
  expect(b.form.last10.map((d: any) => d.result).join('')).toBe('WLWLW');
});
