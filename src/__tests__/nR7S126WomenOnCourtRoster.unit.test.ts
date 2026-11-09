/**
 * N-R7-S126 (Step 2 B10, RW-D2-237): GET /matches/:id/women-on-court gave genders only for the
 * match line-up. The pad's court line-up offers a side's team roster when that side has no match
 * line-up, so a registered woman placed from the roster counted as unknown (0 of at least 2) and her
 * W mark was refused 409 PROFILE_SAYS. The genders now cover both teams' members as well.
 */
import { fakeDb } from './helpers/fakeSupabase';

const M = '11111111-1111-4111-8111-111111111111'; const T = '22222222-2222-4222-8222-222222222222';
const TA = '33333333-3333-4333-8333-333333333333'; const TB = '44444444-4444-4444-8444-444444444444';
let db = fakeDb();
const mk = () => fakeDb({
  matches: [{ id: M, tournament_id: T, team_a_id: TA, team_b_id: TB }],
  tournaments: [{ id: T, settings: { v: 1, category: { gender: 'mixed', minWomen: 2 }, genderMarks: { 'u-ng': 'female' } } }],
  match_participants: [{ id: 'p1', match_id: M, user_id: 'u-a1' }],
  team_members: [
    { id: 'm1', team_id: TA, user_id: 'u-a1' },
    { id: 'm2', team_id: TB, user_id: 'u-w1' }, { id: 'm3', team_id: TB, user_id: 'u-m1' }, { id: 'm4', team_id: TB, user_id: 'u-ng' },
    { id: 'm5', team_id: 'other', user_id: 'u-out' },
  ],
  users: [
    { id: 'u-a1', gender: 'male' }, { id: 'u-w1', gender: 'female' }, { id: 'u-m1', gender: 'male' }, { id: 'u-ng', gender: null }, { id: 'u-out', gender: 'female' },
  ],
});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { getWomenOnCourt } from '../controllers/squads.controller';

const call = async () => {
  let body: any = null; let status = 200;
  const res: any = { status(s: number) { status = s; return res; }, json(b: unknown) { body = b; return res; } };
  await getWomenOnCourt({ userId: 'u-org', params: { id: M } } as any, res);
  return { status, body };
};

test("a side with no match line-up: its roster's genders are given (profile, else the event's mark)", async () => {
  db = mk();
  const { status, body } = await call();
  expect(status).toBe(200);
  expect(body.min_women).toBe(2);
  expect(body.genders).toEqual({ 'u-a1': 'male', 'u-w1': 'female', 'u-m1': 'male', 'u-ng': 'female' });
  expect(body.marked).toEqual(['u-ng']);
  expect(body.genders['u-out']).toBeUndefined();
});
