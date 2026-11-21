/**
 * Q34 (Dipak, 21 Nov 2026: A) · N-FMT-3: on a Swiss tournament's Leaders tab a free round (pairing bye,
 * half-point bye, an absent zero bye) is no game — 'Most wins' counts only games played — while the
 * table keeps the bye's points. (Built by N-R7-S41; locked here with the N-FMT-3 rows.)
 */
import { sportBoards } from '../utils/sportLeaders';
import { computeStats, CHESS_POINTS } from '../utils/standings';

const bye = (t: string, kind?: 'half' | 'zero', more: object = {}) => ({ bye: true, ...(kind ? { bye_kind: kind } : {}), ...more, A: { score: kind === 'half' ? 0.5 : kind === 'zero' ? 0 : 1 }, B: { score: 0 }, result: `${t} bye` });
const rows: any[] = [
  { id: 'm1', team_a_id: 'T1', team_b_id: 'T2', winner_team_id: 'T1', status: 'completed', result_type: null, score_summary: { A: { score: 1 }, B: { score: 0 } } },
  { id: 'b1', team_a_id: 'T3', team_b_id: null, winner_team_id: 'T3', status: 'completed', result_type: null, score_summary: bye('T3') },
  { id: 'b2', team_a_id: 'T4', team_b_id: null, winner_team_id: null, status: 'completed', result_type: null, score_summary: bye('T4', 'zero', { requested: true, absent: true }) },
  { id: 'b3', team_a_id: 'T5', team_b_id: null, winner_team_id: null, status: 'completed', result_type: null, score_summary: bye('T5', 'half', { requested: true }) },
  { id: 'm2', team_a_id: 'T4', team_b_id: 'T2', winner_team_id: 'T4', status: 'completed', result_type: null, score_summary: { A: { score: 1 }, B: { score: 0 } } },
  { id: 'm3', team_a_id: 'T5', team_b_id: 'T1', winner_team_id: 'T5', status: 'completed', result_type: null, score_summary: { A: { score: 1 }, B: { score: 0 } } },
];
const names = { T1: 'T1', T2: 'T2', T3: 'T3', T4: 'T4', T5: 'T5' };

test.each(['chess', 'badminton'])('%s: Most wins counts games played only; byes are not wins or draws', (sport) => {
  const wins = sportBoards(sport, rows.map((m) => ({ ...m })) as never, names).find((b) => b.stat === 'wins')!;
  expect(wins.rows.map((r) => `${r.name} ${r.value} (${r.detail})`)).toEqual(['T4 1 (1W–0L)', 'T5 1 (1W–0L)', 'T1 1 (1W–1L)']);
});

test('the table keeps the bye points (pairing bye 1, half bye ½, absent 0)', () => {
  const s = computeStats(Object.keys(names), rows as never, undefined, CHESS_POINTS);
  expect([s.get('T3')!.points, s.get('T4')!.points, s.get('T5')!.points]).toEqual([1, 1, 1.5]);
});
