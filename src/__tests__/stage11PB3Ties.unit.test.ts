/**
 * Stage 11 · PB3 · the server's tie rollup with league ties: a match's own
 * rules (MLP's side-out games and the rally DreamBreaker), the deciding match
 * at 2-2 flagged on the summary, a timed match left level inside a tie, and
 * table points that count a win in the deciding match apart (3 / 2 / 1 / 0).
 */
import { rollupTieSpec } from '../controllers/scoring.controller';
import { standardRules, type MatchRules } from '../utils/matchRules';
import { computeStats, type GMatch } from '../utils/standings';
import type { TieSpec } from '../utils/tieCore';

const sideOf = (p: any): 'A' | 'B' => (p?.team_side === 'B' ? 'B' : 'A');
const rally = (side: 'A' | 'B', n = 1) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, kind: 'rally' } }));
const point = (side: 'A' | 'B', n = 1) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, kind: 'point', value: 1 } }));
const so11 = { scoring: 'sideout', bestOf: 1, target: 11 };
const D = (key: string) => ({ key, label: key, players: 2 as const, rules: so11 });
const MLP: TieSpec = { rubbers: [D('WD'), D('MD'), D('XD1'), D('XD2'), { key: 'DB', label: 'DreamBreaker', players: 1, decider: true, rules: { scoring: 'rally', bestOf: 1, target: 21 }, rotateEvery: 4 }], win: 'first', repeatPlayers: true };
const rules = { ...standardRules('pickleball'), tie: MLP } as MatchRules;
const gameA = rally('A', 11); // A serves first in each fresh match and wins every rally
const gameB = rally('B', 12); // A's serve lost (side out), then B wins 11 serving

describe('PB3 · rollupTieSpec', () => {
  it('2-2 after the four side-out games, then the rally DreamBreaker to 21 decides it', () => {
    const t = rollupTieSpec('pickleball', rules, MLP, [...gameA, ...gameB, ...gameA, ...gameB, ...point('A', 21)], sideOf);
    expect(t.tie).toMatchObject({ decided: 'A', decider: true, rubbersA: 3, rubbersB: 2 });
    expect(t.results.map((r) => r.winner)).toEqual(['A', 'B', 'A', 'B', 'A']);
    expect(t.results[4]).toMatchObject({ unitsA: 21, unitsB: 0 });
  });
  it('3-1 ends it with no DreamBreaker', () => {
    const t = rollupTieSpec('pickleball', rules, MLP, [...gameA, ...gameA, ...gameB, ...gameA], sideOf);
    expect(t.tie).toMatchObject({ decided: 'A', rubbersA: 3, rubbersB: 1 });
    expect(t.tie.decider).toBeUndefined();
  });
  it('a timed match inside a tie can end level', () => {
    const timed = { scoring: 'rally', bestOf: 1, target: 25, winBy2: false, timeLimitMinutes: 15, timedLevel: 'draw' };
    const spec: TieSpec = { rubbers: [{ key: 'M1', label: 'M1', players: 1, rules: timed }, { key: 'M2', label: 'M2', players: 1, rules: timed }, { key: 'DEC', label: 'Decider', players: 2, decider: true, rules: { scoring: 'rally', bestOf: 1, target: 7, winBy2: false } }], win: 'all' };
    const t = rollupTieSpec('pickleball', { ...standardRules('pickleball'), tie: spec } as MatchRules, spec,
      [...point('A', 16), ...point('B', 16), { event_type: 'note', payload: { kind: 'buzzer' } }, ...point('A', 10), ...point('B', 10), { event_type: 'note', payload: { kind: 'buzzer' } }, ...point('A', 7)], sideOf);
    expect(t.results.map((r) => r.winner)).toEqual(['draw', 'draw', 'A']);
    expect(t.tie).toMatchObject({ decided: 'A', decider: true });
  });
});

describe('PB3 · table points', () => {
  const pts = { win: 1, draw: 0.5, loss: 0, sets: { straight: [3, 0] as [number, number], decider: [2, 1] as [number, number] } };
  const tie = (a: string, b: string, winner: string, decider: boolean): GMatch => ({ team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed', score_summary: { A: { score: 3 }, B: { score: 2 }, tie: { decided: 'A', decider } } });
  it('a regulation win 3, a DreamBreaker win 2, a DreamBreaker loss 1', () => {
    const st = computeStats(['x', 'y', 'z'], [tie('x', 'y', 'x', false), tie('y', 'z', 'y', true)], undefined, pts);
    expect(st.get('x')!.points).toBe(3); expect(st.get('y')!.points).toBe(2); expect(st.get('z')!.points).toBe(1);
  });
});
