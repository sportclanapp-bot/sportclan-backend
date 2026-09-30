/** BUILD 3.62 · a match tiebreak for the final set — the server decides it and the push says so. */
import { tennisReplay } from '../utils/tennisCore';
import { standardRules, tennisOptsOf } from '../utils/matchRules';
import { scorePush } from '../utils/scorePush';

test('the server replays it', () => {
  const p = (s: 'A' | 'B', n: number) => Array.from({ length: n }, () => s);
  const t = tennisReplay([...p('A', 24), ...p('B', 24), ...p('B', 10)], tennisOptsOf({ ...standardRules('tennis'), matchTiebreak: true }));
  expect(t.winner).toBe('B');
  expect(t.sets[2]).toEqual({ A: 0, B: 1, tiebreak: { A: 0, B: 10 } });
});
test('the push names the match tiebreak', () => {
  const prev = { A: { sets: [6, 0] }, B: { sets: [0, 6] } };
  const now = { A: { sets: [6, 0, 0], games: 0, points: 0 }, B: { sets: [0, 6, 1], games: 0, points: 0 }, set_tiebreaks: [null, null, { A: 8, B: 10 }] };
  expect(scorePush({ slug: 'tennis', summary: now, side: 'B', teamName: 'Aces', prevSummary: prev })).toEqual({ title: 'Match tiebreak to Aces', body: 'Aces wins the match tiebreak · 10–8' });
});
