/**
 * N-R7-S152 (Step 2, Batch 14 · SIDE-B5-1): Advanced Stats' head-to-head named the same opponent as
 * 'Best' and 'Toughest' when only one opponent had 2+ games (or every one had the same win rate).
 * Now one opponent is named once: as Best at 50% or more, as Toughest below; Toughest is shown only
 * when someone's win rate is lower than Best's.
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
const OPP2 = '33333333-3333-4333-8333-333333333333';
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

type G = { delta: number; mySide: 'A' | 'B'; winner_side: 'A' | 'B' | null; result_type: string | null; opp?: string };
async function run(games: G[]) {
  let r0 = 1500;
  const matches = games.map((g, i) => ({ id: uuid(i + 1), team_a_id: null, team_b_id: null, team_a_name: null, team_b_name: null, winner_team_id: null,
    winner_side: g.winner_side, result_type: g.result_type, scheduled_at: '2026-11-05T10:00:00Z', format: 'singles', city_id: null, voided_at: null }));
  const rating_history = games.map((g, i) => { const old = r0; r0 = +(r0 + g.delta).toFixed(2);
    return { id: uuid(5000 + i), user_id: ME, sport_id: 's', match_id: matches[i]!.id, old_rating: old, new_rating: r0, delta: g.delta,
      created_at: new Date(Date.UTC(2026, 10, 5, 10, i)).toISOString(), match: { id: matches[i]!.id, voided_at: null } }; });
  db = fakeDb({ users: [{ id: ME, deleted_at: null, name: 'Me' }, { id: OPP, deleted_at: null, name: 'Opp' }, { id: OPP2, deleted_at: null, name: 'Opp Two' }], rating_history,
    user_sport_profiles: [{ user_id: ME, sport_id: 's', rating: r0 }], matches,
    match_participants: games.flatMap((g, i) => [{ match_id: matches[i]!.id, user_id: ME, team_side: g.mySide },
      { match_id: matches[i]!.id, user_id: g.opp ?? OPP, team_side: g.mySide === 'A' ? 'B' : 'A' }]) });
  const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.setHeader = () => r; r.set = () => r;
  await getAdvancedStats({ userId: ME, params: {}, query: { sport_id: 'chess' }, header: () => undefined, headers: {} } as any, r);
  expect(r.statusCode).toBe(200);
  return r.body;
}

const W = (opp?: string): G => ({ delta: 8, mySide: 'A', winner_side: 'A', result_type: 'decisive', opp });
const L = (opp?: string): G => ({ delta: -8, mySide: 'A', winner_side: 'B', result_type: 'decisive', opp });

// one game each against three others: enough games for the full page, none of them qualifies (2+ games)
const PAD: G[] = [W(uuid(9001)), L(uuid(9002)), W(uuid(9003))];

test('one opponent you mostly beat: Best only', async () => {
  const b = await run([W(), W(), L(), ...PAD]);
  expect(b.headToHead.best).toMatchObject({ name: 'Opp', winRate: 67 });
  expect(b.headToHead.worst).toBeNull();
});

test('one opponent you mostly lose to: Toughest only', async () => {
  const b = await run([L(), L(), W(), ...PAD]);
  expect(b.headToHead.best).toBeNull();
  expect(b.headToHead.worst).toMatchObject({ name: 'Opp', winRate: 33 });
});

test('two opponents at the same win rate: named once', async () => {
  const b = await run([W(), L(), W(OPP2), L(OPP2), ...PAD]);
  expect(b.headToHead.best).toMatchObject({ winRate: 50 });
  expect(b.headToHead.worst).toBeNull();
});

test('two opponents at different rates: Best and Toughest are different people', async () => {
  const b = await run([W(), W(), L(OPP2), L(OPP2), W(OPP2)]);
  expect(b.headToHead.best).toMatchObject({ name: 'Opp', winRate: 100 });
  expect(b.headToHead.worst).toMatchObject({ name: 'Opp Two', winRate: 33 });
});
