/**
 * Badminton gap 8 (Oct 2026) · placings per event: winner, runner-up and the
 * two semi-finalists (or third and fourth when a third-place match was
 * played, or a finished table's top four), each with its players.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;
const P = id(1); const KO = id(2); const RR = id(3);
let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'badminton' })) }));
// eslint-disable-next-line import/first
import { getPlacings, knockoutPlacings } from '../controllers/awards.controller';

const m = (o: Record<string, unknown>) => ({ voided_at: null, group_label: null, third_place: false, status: 'completed', team_a_name: null, team_b_name: null, ...o });
const KO_MATCHES = [
  m({ id: 'sf1', round: 1, team_a_id: 'a', team_b_id: 'b', team_a_name: 'Ravi', team_b_name: 'Amit', winner_team_id: 'a' }),
  m({ id: 'sf2', round: 1, team_a_id: 'c', team_b_id: 'd', team_a_name: 'Kiran', team_b_name: 'Dev', winner_team_id: 'd' }),
  m({ id: 'f', round: 2, team_a_id: 'a', team_b_id: 'd', team_a_name: 'Ravi', team_b_name: 'Dev', winner_team_id: 'd' }),
];
const run = async (params: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getPlacings({ userId: 'u', params } as any, r);
  return r;
};

test('a knockout: winner, runner-up and two semi-finalists (two bronzes)', () => {
  expect(knockoutPlacings(KO_MATCHES as never).map((p) => `${p.place} ${p.title} ${p.name}`)).toEqual(['1 Winner Dev', '2 Runner-up Ravi', '3 Semi-finalist Amit', '3 Semi-finalist Kiran']);
});
test('a third-place match: third and fourth instead', () => {
  const withThird = [...KO_MATCHES, m({ id: 't', round: 2, third_place: true, team_a_id: 'b', team_b_id: 'c', team_a_name: 'Amit', team_b_name: 'Kiran', winner_team_id: 'c' })];
  expect(knockoutPlacings(withThird as never).map((p) => `${p.place} ${p.title} ${p.name}`)).toEqual(['1 Winner Dev', '2 Runner-up Ravi', '3 Third Kiran', '4 Fourth Amit']);
});
test('no final yet: no placings', () => {
  expect(knockoutPlacings([KO_MATCHES[0], KO_MATCHES[1], { ...KO_MATCHES[2], status: 'scheduled', winner_team_id: null }] as never)).toEqual([]);
});
test('a tournament made of events: each event, with the players (captain first)', async () => {
  db = fakeDb({
    tournaments: [
      { id: P, name: 'Open', is_parent: true },
      { id: KO, parent_id: P, name: 'Open · MS', event_label: 'MS', event_order: 0, format: 'knockout', status: 'completed', sport_id: 's' },
      { id: RR, parent_id: P, name: 'Open · XD', event_label: 'XD', event_order: 1, format: 'round_robin', status: 'completed', sport_id: 's', settings: null, tiebreaker_rules: [] },
    ],
    matches: [
      ...KO_MATCHES.map((x) => ({ ...x, tournament_id: KO })),
      m({ id: 'r1', tournament_id: RR, round: 1, team_a_id: 'x', team_b_id: 'y', winner_team_id: 'y', score_summary: { A: { score: 0 }, B: { score: 2 } } }),
    ],
    tournament_entries: [{ tournament_id: RR, team_id: 'x', status: 'approved' }, { tournament_id: RR, team_id: 'y', status: 'approved' }],
    teams: [{ id: 'x', name: 'Sara / Om' }, { id: 'y', name: 'Neha / Raj' }],
    team_members: [{ team_id: 'd', user_id: 'u-dev', role: 'captain' }, { team_id: 'y', user_id: 'u-raj', role: 'vice_captain' }, { team_id: 'y', user_id: 'u-neha', role: 'captain' }],
    users: [{ id: 'u-dev', name: 'Dev', deleted_at: null }, { id: 'u-neha', name: 'Neha', deleted_at: null }, { id: 'u-raj', name: 'Raj', deleted_at: null }],
  });
  const r = await run({ id: P });
  expect(r.body.events.map((e: any) => e.label)).toEqual(['MS', 'XD']);
  expect(r.body.events[0].placings[0]).toEqual({ place: 1, title: 'Winner', team_id: 'd', name: 'Dev', players: [{ id: 'u-dev', name: 'Dev' }] });
  // the table's top: Neha / Raj won
  expect(r.body.events[1].placings[0]).toMatchObject({ place: 1, title: 'Winner', team_id: 'y', players: [{ id: 'u-neha', name: 'Neha' }, { id: 'u-raj', name: 'Raj' }] });
  expect(r.body.events[1].placings[1]).toMatchObject({ place: 2, title: 'Runner-up', team_id: 'x', players: [] });
});
