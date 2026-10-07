/**
 * Stage 8 · F7 · awards: the computed ones per sport (Golden Boot, top scorer,
 * player of the tournament…, the fair-play team) and the organiser's own for
 * any sport; FIFA fair-play points.
 */
import { fakeDb } from './helpers/fakeSupabase';
import { fairPlayPoints } from '../utils/fairPlay';

const id = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;
const T = id(1); const ORG = id(2); const P1 = id(3); const TA = id(10); const TB = id(11);
let db = fakeDb({});
const mk = () => fakeDb({
  tournaments: [{ id: T, created_by: ORG, parent_id: null, format: 'league', sport_id: 'sp-fb', settings: { v: 1 }, is_parent: false }],
  tournament_organisers: [], sports: [{ id: 'sp-fb', slug: 'football' }],
  users: [{ id: P1, name: 'Ravi', deleted_at: null }, { id: ORG, name: 'Org', deleted_at: null }],
  teams: [{ id: TA, name: 'Lions' }, { id: TB, name: 'Tigers' }],
});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: 'football' })) }));
jest.mock('../controllers/features.controller', () => ({ loadLeaders: jest.fn(async () => ({
  slug: 'football', topWins: [], performers: [], leaders: null,
  boards: [
    { stat: 'goals', rows: [{ user_id: 'u1', name: 'Ravi', team_name: 'Lions', value: 3 }, { user_id: 'u2', name: 'Amit', team_name: 'Tigers', value: 3 }, { user_id: 'u3', name: 'Dev', team_name: 'Tigers', value: 1 }] },
    { stat: 'assists', rows: [] },
  ],
  played: [{ id: 'm1', team_a_id: TA, team_b_id: TB }], teamMap: new Map([[TA, 'Lions'], [TB, 'Tigers']]),
})) }));

// eslint-disable-next-line import/first
import { getAwards, setAwards, computedAwards } from '../controllers/awards.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params, body, query: {} } as any, r);
  return r;
};
beforeEach(() => { db = mk(); });

test('FIFA fair play: −1 a yellow, −3 a second yellow, −4 a straight red, −5 a yellow then a red; per player per match', () => {
  const teams = new Map([['m1', { A: 'tA', B: 'tB' }], ['m2', { A: 'tB', B: 'tA' }]]);
  const c = (match_id: string, side: string, kind: string, player_id?: string, extra: object = {}) => ({ match_id, payload: { team_side: side, kind, player_id, ...extra } });
  const pts = fairPlayPoints([
    c('m1', 'A', 'yellow', 'p1'), c('m1', 'A', 'yellow', 'p1'), c('m1', 'A', 'red', 'p1', { second_yellow: true }), // −3
    c('m1', 'A', 'yellow', 'p2'), // −1
    c('m1', 'B', 'yellow', 'q1'), c('m1', 'B', 'red', 'q1'), // −5
    c('m2', 'A', 'red', 'q2'), // tB −4
    c('m2', 'B', 'yellow'), c('m2', 'B', 'yellow'), // tA: two unnamed yellows −2
  ], teams);
  expect([pts.get('tA'), pts.get('tB')]).toEqual([-6, -9]);
});

test('computed: joint Golden Boot; fair play only when someone was booked; cricket’s', () => {
  const boards = [{ stat: 'goals', rows: [{ user_id: 'u1', name: 'Ravi', team_name: 'Lions', value: 3 }, { user_id: 'u2', name: 'Amit', team_name: 'Tigers', value: 3 }] }];
  const names = new Map([['tA', 'Lions'], ['tB', 'Tigers'], ['tC', 'Eagles']]);
  const a = computedAwards('football', boards, new Map([['tB', -2]]), ['tA', 'tB', 'tC'], names);
  expect(a.map((x) => [x.title, x.winners.map((w) => w.name).join(' & '), x.value])).toEqual([['Golden Boot', 'Ravi & Amit', '3 goals'], ['Fair play', 'Lions & Eagles', 'no cards']]);
  expect(computedAwards('football', boards, new Map(), ['tA', 'tB'], names).map((x) => x.key)).toEqual(['golden_boot']);
  expect(computedAwards('badminton', boards, null, [], names)).toEqual([]);
  expect(computedAwards('cricket', [{ stat: 'player_of_tournament', rows: [{ user_id: 'u', name: 'Kiran', team_name: 'Royals', value: 1 }] }], null, [], names)[0]).toMatchObject({ title: 'Player of the tournament', value: '1 pt' });
});

test('the organiser gives awards (any number, a person, a name or a team); others can’t; refusals', async () => {
  const awards = [{ title: 'Best goalkeeper', user_id: P1 }, { title: 'Emerging player', name: 'Raju' }, { title: 'Best supporters', team_id: TB }];
  expect((await run(setAwards, P1, { id: T }, { awards })).statusCode).toBe(403);
  const r = await run(setAwards, ORG, { id: T }, { awards });
  expect(r.statusCode).toBe(200);
  expect(r.body.picked.map((x: any) => [x.title, x.name, x.team_name])).toEqual([['Best goalkeeper', 'Ravi', null], ['Emerging player', 'Raju', null], ['Best supporters', null, 'Tigers']]);
  expect(db.t('tournaments')[0]!.settings.awards).toHaveLength(3);
  expect((await run(setAwards, ORG, { id: T }, { awards: [{ title: '', name: 'X' }] })).body.error).toMatch(/title is 1 to 60/);
  expect((await run(setAwards, ORG, { id: T }, { awards: [{ title: 'Best player' }] })).body.error).toBe('Say who “Best player” goes to.');
  const g = await run(getAwards, P1, { id: T });
  expect(g.body.can_edit).toBe(false);
  expect(g.body.picked).toHaveLength(3);
  expect(g.body.computed.map((x: any) => x.title)).toEqual(['Golden Boot']);
  const cleared = await run(setAwards, ORG, { id: T }, { awards: [] });
  expect(cleared.body.picked).toEqual([]);
  expect(db.t('tournaments')[0]!.settings.awards).toBeUndefined();
});
