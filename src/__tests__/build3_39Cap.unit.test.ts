/** BUILD 3.39 · volleyball's point cap: off (standard), or the target to target + 10, not below the decider's target. */
import { rulesRefusal, standardRules, setConfigOf, timedRulesLabel } from '../utils/matchRules';
import { rollupSets } from '../controllers/scoring.controller';

const vb = (x: object) => rulesRefusal('volleyball', { ...standardRules('volleyball'), ...x });
test('the range', () => {
  for (const ok of [{ cap: null }, { cap: 25 }, { cap: 35 }, { target: 21, cap: 31 }]) expect(vb(ok)).toBeNull();
  expect(vb({ cap: 24 })?.error).toBe('The cap must be off, or 25 to 35.');
  expect(vb({ cap: 36 })?.field).toBe('cap');
  expect(vb({ target: 10, finalTarget: 25, cap: 20 })?.error).toBe('A cap can’t fit this deciding set — turn the cap off.');
  expect(vb({ target: 21, finalTarget: 25, cap: 28 })).toBeNull();
  expect(timedRulesLabel('volleyball', { ...standardRules('volleyball'), cap: 30 })).toBe('cap 30');
});
test('a set capped at 27 ends there, level or not', () => {
  const pts = (side: string, n: number) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, value: 1 } }));
  const cfg = setConfigOf({ ...standardRules('volleyball'), cap: 27 });
  const seq = [...pts('A', 24), ...pts('B', 24)];
  for (let i = 0; i < 2; i++) seq.push(...pts('A', 1), ...pts('B', 1));
  seq.push(...pts('A', 1));
  const r = rollupSets(cfg, seq, (p) => (p.team_side === 'B' ? 'B' : 'A'));
  expect(r.setScoresA[0]).toBe(27);
});
