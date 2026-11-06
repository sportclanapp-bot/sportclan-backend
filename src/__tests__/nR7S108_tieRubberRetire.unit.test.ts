/**
 * N-R7-S108 (Step 2, Batch 9, SPP1-CRM-056 on local 4101): in a team tie a player who retires
 * hands the RUBBER in play to the other side and the tie goes on (ICF: the rubber is lost, not
 * the tie). The Retire (POST /matches/:id/complete retired) ended the whole tie for the other team
 * at 0–0 instead. Now the retirement is a 'retire' note in the rubber: it decides that rubber only.
 */
import { rollupTieSpec } from '../controllers/scoring.controller';
import { type TieSpec } from '../utils/tieCore';
import { standardRules } from '../utils/matchRules';

const pt = (side: 'A' | 'B', n = 1) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side } }));
const side = (p: any) => (p?.team_side === 'B' ? 'B' : 'A') as 'A' | 'B';
const R = (n: number) => ({ key: `S${n}`, label: `Singles ${n}`, players: 1 as const });
const spec: TieSpec = { rubbers: [R(1), R(2), R(3)], win: 'first' };
const rules = { ...standardRules('badminton'), bestOf: 1, tie: spec };
const retire = (s: 'A' | 'B') => ({ event_type: 'note', payload: { kind: 'retire', team_side: s } });

test('a retirement at 10–13 in Singles 1 (badminton to 15) gives Singles 1 to the other side; the tie is 0–1 and Singles 2 is next', () => {
  const t = rollupTieSpec('badminton', rules, spec, [...pt('A', 10), ...pt('B', 13), retire('A')], side);
  expect(t.results.map((r) => [r.key, r.winner, (r as any).retired])).toEqual([['S1', 'B', 'A']]);
  expect([t.tie.rubbersA, t.tie.rubbersB, t.tie.decided]).toEqual([0, 1, null]);
  expect(t.rubber).toBe(2);
});

test('a retirement that gives a side its second rubber decides the tie', () => {
  const t = rollupTieSpec('badminton', rules, spec, [...pt('B', 15), ...pt('A', 3), retire('A')], side);
  expect([t.tie.rubbersA, t.tie.rubbersB, t.tie.decided]).toEqual([0, 2, 'B']);
});
