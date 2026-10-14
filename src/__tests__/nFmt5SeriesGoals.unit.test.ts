/**
 * N-FMT-5 (launch test plan, Round 2): a league played as best-of-3 series counted games won as
 * goals — a series won 1–0, 1–1 (pens) showed 2–0 and GD +2. The table now sums each game's goals.
 */
import { computeStats } from '../utils/standings';
import fs from 'fs';
import path from 'path';

const series = { team_a_id: 'T', team_b_id: 'B', winner_team_id: 'T', status: 'completed', score_summary: { A: { sets: [1, 1], score: 2 }, B: { sets: [0, 1], score: 0 }, tie: { win: 'first', rubbersA: 2, rubbersB: 0, unitsA: 2, unitsB: 1, decided: 'A', series: true }, winner_side: 'A' } };
test('a series won 1–0, 1–1: 2–1 and +1', () => {
  const st = computeStats(['T', 'B'], [series] as never);
  expect([st.get('T')!.scored, st.get('T')!.conceded, st.get('T')!.diff]).toEqual([2, 1, 1]);
  expect([st.get('B')!.scored, st.get('B')!.conceded, st.get('B')!.diff]).toEqual([1, 2, -1]);
  expect(st.get('T')!.won).toBe(1);
});
test('a team tie (not a series) keeps its matches won', () => {
  const tie = { ...series, score_summary: { ...series.score_summary, tie: { ...series.score_summary.tie, series: undefined } } };
  expect(computeStats(['T', 'B'], [tie] as never).get('T')!.scored).toBe(2);
});
test('the server marks a football / hockey / basketball series as one', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(s).toContain("tieSummary = { ...t.tie, series: true }; // N-FMT-5");
});
