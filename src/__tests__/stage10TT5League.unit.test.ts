/**
 * Stage 10 · TT5 · the server agrees with the pad: every game played (the set
 * rollup, side-out pickleball, the completion check) and the golden point.
 */
import { bestOfState, rollupSets } from '../controllers/scoring.controller';
import { setConfigOf, standardRules } from '../utils/matchRules';
import { sideOutReplay } from '../utils/pickleballCore';

const pts = (side: 'A' | 'B', n: number) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side } }));
const game = (w: 'A' | 'B') => [...pts(w === 'A' ? 'B' : 'A', 5), ...pts(w, 11)];
const sideOf = (p: any) => p.team_side;

test('the set rollup: 2-0 isn’t decided with every game played; 2-1 is', () => {
  const cfg = setConfigOf({ ...standardRules('tabletennis'), bestOf: 3, allGames: true });
  expect(rollupSets(cfg, [...game('A'), ...game('A')], sideOf).decided).toBeNull();
  const r = rollupSets(cfg, [...game('A'), ...game('A'), ...game('B')], sideOf);
  expect([r.setsA, r.setsB, r.decided]).toEqual([2, 1, 'A']);
  // without it, 2-0 ends the match (as before)
  expect(rollupSets(setConfigOf({ ...standardRules('tabletennis'), bestOf: 3 }), [...game('A'), ...game('A')], sideOf).decided).toBe('A');
});

test('the golden point: 11-10', () => {
  const cfg = setConfigOf({ ...standardRules('tabletennis'), bestOf: 3, winBy2: false });
  const r = rollupSets(cfg, [...pts('A', 10), ...pts('B', 10), ...pts('A', 1)], sideOf);
  expect([r.setScoresA, r.setScoresB]).toEqual([[11], [10]]);
});

test('completing: a 2-0 lead with every game played can’t end the match yet', () => {
  const rules = { ...standardRules('tabletennis'), bestOf: 3, allGames: true };
  expect(bestOfState('tabletennis', { A: { score: 2 }, B: { score: 0 } }, { rules })!.decided).toBe(false);
  expect(bestOfState('tabletennis', { A: { score: 2 }, B: { score: 1 } }, { rules })!.decided).toBe(true);
  expect(bestOfState('tabletennis', { A: { score: 2 }, B: { score: 0 } }, { rules: { ...rules, allGames: false } })!.decided).toBe(true);
});

test('side-out pickleball plays every game too', () => {
  // side-out: points score only for the server; a rally list that gives A each game 11-0 while serving
  const r = sideOutReplay([...pts('A', 11), ...pts('A', 11)] as never, { target: 11, winBy2: true, maxGames: 3, doubles: false, allGames: true });
  expect(r.winner ?? null).toBeNull();
});
