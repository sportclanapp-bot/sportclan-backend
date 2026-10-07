/**
 * Stage 8 · F6 · leaderboards for every sport, each its own stats.
 */
import { sportBoards } from '../utils/sportLeaders';
import { cricketBoards } from '../controllers/features.controller';

const TEAMS = { tA: 'Lions', tB: 'Tigers', tC: 'Eagles' };
const fb = (id: string, a: string, b: string, ga: number, gb: number, players: Record<string, Record<string, unknown>>, extra: object = {}) => ({
  id, team_a_id: a, team_b_id: b, winner_team_id: ga > gb ? a : gb > ga ? b : null,
  score_summary: { A: { score: ga }, B: { score: gb }, players }, ...extra,
});

test('football: top scorers, assists, cards (a red counts 3), clean sheets by team; guests by name within a team; deleted accounts off', () => {
  const m = [
    fb('m1', 'tA', 'tB', 2, 0, { u1: { side: 'A', name: 'Ravi', goals: 2, assists: 0 }, u2: { side: 'A', name: 'Amit', goals: 0, assists: 2, yellow_cards: 1 }, 'guest:x': { side: 'B', name: 'Raju', goals: 0, red_cards: 1 } }),
    fb('m2', 'tA', 'tC', 1, 1, { u1: { side: 'A', name: 'Ravi', goals: 1, yellow_cards: 1 }, u9: { side: 'B', name: 'Gone', goals: 5 }, 'guest:y': { side: 'B', name: 'raju ', goals: 1 } }),
  ];
  const b = sportBoards('football', m, TEAMS, { u9: { name: 'Gone', deleted: true } });
  expect(b.map((x) => x.title)).toEqual(['Top scorers', 'Assists', 'Cards', 'Clean sheets']);
  expect(b[0]!.rows.map((r) => [r.name, r.value, r.team_name, r.detail])).toEqual([['Ravi', 3, 'Lions', '2 matches'], ['raju', 1, 'Eagles', '1 match']]);
  expect(b[1]!.rows.map((r) => [r.name, r.value])).toEqual([['Amit', 2]]);
  expect(b[2]!.rows.map((r) => [r.name, r.value, r.detail])).toEqual([['Raju', 3, '🟥 1'], ['Amit', 1, '🟨 1'], ['Ravi', 1, '🟨 1']]);
  expect([b[3]!.kind, b[3]!.rows.map((r) => [r.name, r.value])]).toEqual(['team', [['Lions', 1]]]);
});

test('badminton: matches won, games won, points difference (team ties and walkovers count only as wins)', () => {
  const g = (id: string, a: string, b: string, A: number[], B: number[], w: string, extra: object = {}) => ({ id, team_a_id: a, team_b_id: b, winner_team_id: w, score_summary: { A: { sets: A }, B: { sets: B } }, ...extra });
  const m = [
    g('m1', 'tA', 'tB', [21, 18, 21], [15, 21, 10], 'tA'),
    g('m2', 'tC', 'tA', [21, 21], [19, 17], 'tC'),
    g('m3', 'tB', 'tC', [], [], 'tB', { result_type: 'walkover' }),
  ];
  const b = sportBoards('badminton', m, TEAMS);
  expect(b.map((x) => x.title)).toEqual(['Most wins', 'Games won', 'Points difference']);
  expect(b[0]!.rows.map((r) => [r.name, r.value, r.detail])).toEqual([['Eagles', 1, '1W–1L'], ['Lions', 1, '1W–1L'], ['Tigers', 1, '1W–1L']]);
  expect(b[1]!.rows.map((r) => [r.name, r.value, r.detail])).toEqual([['Eagles', 2, '2–0'], ['Lions', 2, '2–3'], ['Tigers', 1, '1–2']]); // level: fewer games lost first
  expect(b[2]!.rows.map((r) => [r.name, r.value, r.detail])).toEqual([['Lions', 8, '96–88'], ['Eagles', 6, '42–36'], ['Tigers', -14, '46–60']]); // Lions +14 then −6
});

test('the other sports’ boards; cricket in the same shape', () => {
  expect(sportBoards('volleyball', [], TEAMS).map((x) => x.title)).toEqual(['Most wins', 'Sets won', 'Points difference']);
  expect(sportBoards('tennis', [], TEAMS).map((x) => x.title)).toEqual(['Most wins', 'Sets won']);
  expect(sportBoards('basketball', [], TEAMS).map((x) => x.title)).toEqual(['Top scorers', 'Assists']);
  expect(sportBoards('chess', [], TEAMS).map((x) => x.title)).toEqual(['Most wins']);
  expect(sportBoards('cricket', [], TEAMS)).toEqual([]);
  const cb = cricketBoards({ runs: [{ user_id: 'u', name: 'Ravi', team_id: 'tA', team_name: 'Lions', value: 75, detail: '2 matches', stat: 'runs' }], wickets: [], best_bowling: [], sixes: [], catches: [], player_of_tournament: [] } as never);
  expect(cb.map((x) => x.title)).toEqual(['Most runs', 'Most wickets', 'Best bowling', 'Most sixes', 'Most catches', 'Player of the tournament']);
  expect(cb[0]!.rows[0]).toEqual({ user_id: 'u', team_id: 'tA', name: 'Ravi', team_name: 'Lions', value: 75, detail: '2 matches' });
});
