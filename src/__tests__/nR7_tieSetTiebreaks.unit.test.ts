/**
 * Step 2 B5 (H4 finding): a tennis team tie's final line dropped the tiebreak points —
 * '6–4 · 2–6 · 6–3 · 6–7' when the last rubber was 7–6(4). The tie summary had no
 * set_tiebreaks; it now carries one per set across the rubbers, like a single match.
 */
import { rollupTieSpec } from '../controllers/scoring.controller';
import { type TieSpec } from '../utils/tieCore';
import { standardRules, type MatchRules } from '../utils/matchRules';

const pt = (side: 'A' | 'B', n = 1) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side } }));
const side = (p: any) => (p?.team_side === 'B' ? 'B' : 'A') as 'A' | 'B';
const R = (n: number) => ({ key: `R${n}`, label: `Singles ${n}`, players: 1 as const });

test('a tennis tie keeps each set\'s tiebreak points, null for a set without one', () => {
  const spec: TieSpec = { rubbers: [R(1), R(2)], win: 'all' };
  const rules: MatchRules = { ...standardRules('tennis'), bestOf: 1, tie: spec };
  const sixAll = Array.from({ length: 6 }, () => [...pt('A', 4), ...pt('B', 4)]).flat();
  const events = [...pt('A', 24), ...sixAll, ...pt('B', 4), ...pt('A', 7)];
  const t = rollupTieSpec('tennis', rules, spec, events, side);
  expect([t.setsA, t.setsB]).toEqual([[6, 7], [0, 6]]);
  expect(t.setTiebreaks).toEqual([null, { A: 7, B: 4 }]);
});

test('a badminton tie has no set_tiebreaks', () => {
  const spec: TieSpec = { rubbers: [R(1)], win: 'all' };
  const t = rollupTieSpec('badminton', { ...standardRules('badminton'), tie: spec }, spec, pt('A', 42), side);
  expect(t.setTiebreaks).toBeUndefined();
});
