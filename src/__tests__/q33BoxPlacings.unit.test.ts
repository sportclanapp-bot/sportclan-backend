/**
 * Q33 (Dipak, 21 Nov 2026: A) · N-FMT-1: a completed box league's Winner and Runner-up come from Box 1
 * only, as its champion card. The awards poster / certificates ranked every box together, so Box 2's
 * unbeaten P07 was printed 'Winner' and Box 1's runner-up was left out.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'carrom' })) }));
// eslint-disable-next-line import/first
import { placingsFor } from '../controllers/awards.controller';

const T = '33333333-3333-4333-8333-333333333334';
const m = (id: string, g: string, a: string, b: string, sa: number, sb: number) => ({
  id, tournament_id: T, round: 1, group_label: g, bracket: null, third_place: false, voided_at: null, team_a_id: a, team_b_id: b,
  team_a_name: a, team_b_name: b, winner_team_id: sa > sb ? a : b, status: 'completed', overs: null, result_type: 'decisive',
  score_summary: { A: { score: sa }, B: { score: sb } },
});
const box = [['C', 'D', 'Chetan'], ['P07', 'P08', 'P09']];
const seed = () => fakeDb({
  tournaments: [{ id: T, format: 'box', status: 'completed', sport_id: 'carrom', settings: { v: 1, box: { size: 3, round: 1 } }, tiebreaker_rules: [] }],
  tournament_entries: box.flatMap((ids, b) => ids.map((id, i) => ({ id: 'e' + id, tournament_id: T, team_id: id, status: 'approved', group_label: String(b + 1), seed: b * 3 + i + 1 }))),
  matches: [m('1', '1', 'C', 'D', 2, 1), m('2', '1', 'C', 'Chetan', 2, 1), m('3', '1', 'D', 'Chetan', 2, 1), m('4', '2', 'P07', 'P08', 2, 0), m('5', '2', 'P07', 'P09', 2, 0), m('6', '2', 'P08', 'P09', 2, 0)],
  teams: box.flat().map((id) => ({ id, name: id })),
  team_members: [], users: [],
});

test('Winner C, Runner-up D, third Chetan — all from Box 1; nobody from Box 2', async () => {
  db = seed();
  const out = await placingsFor({ id: T, format: 'box', status: 'completed', sport_id: 'carrom', settings: { v: 1, box: { size: 3, round: 1 } }, tiebreaker_rules: [] });
  expect(out.map((p) => [p.title, p.name])).toEqual([['Winner', 'C'], ['Runner-up', 'D'], ['Third', 'Chetan']]);
});
