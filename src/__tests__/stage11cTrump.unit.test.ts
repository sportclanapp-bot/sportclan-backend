/**
 * Stage 11 follow-up · the trump match on the server: the switch is read from a
 * match's rules without a query; the shared engine counts a side's pick double.
 */
import { hasTrump } from '../utils/tieTrumps';
import { tieOutcome, tieTrumpProblem, type TieSpec } from '../utils/tieCore';
import { rulesRefusal, standardRules } from '../utils/matchRules';

const pbl: TieSpec = { rubbers: ['MS1', 'WS', 'MD', 'XD', 'MS2'].map((k) => ({ key: k, label: k, players: k.endsWith('D') ? 2 : 1 })) as TieSpec['rubbers'], win: 'all', trump: true };
const r = (winner: 'A' | 'B') => ({ key: 'x', winner, sets: { A: [15], B: [9] }, units: { A: 15, B: 9 } });

describe('trump match · server', () => {
  it('hasTrump reads the rules', () => {
    expect(hasTrump({ tie: pbl })).toBe(true);
    expect(hasTrump({ tie: { ...pbl, trump: false } })).toBe(false);
    expect(hasTrump(null)).toBe(false);
    expect(hasTrump({ rubbers: 3 })).toBe(false);
  });
  it('the picks count double for the side that picked', () => {
    expect(tieOutcome({ ...pbl, trumps: { A: 'XD', B: 'MS1' } }, [r('B'), r('A'), r('B'), r('A'), r('B')])).toMatchObject({ rubbersA: 3, rubbersB: 4, decided: 'B' });
    expect(tieOutcome(pbl, [r('B'), r('A'), r('B'), r('A'), r('B')])).toMatchObject({ rubbersA: 2, rubbersB: 3 });
  });
  it('a pick is one of the matches; the rules carry the switch, never the picks', () => {
    expect(tieTrumpProblem(pbl, 'MD')).toBeNull();
    expect(tieTrumpProblem(pbl, undefined)).toMatch(/Pick your trump/);
    expect(rulesRefusal('badminton', { ...standardRules('badminton'), tie: pbl })).toBeNull();
    expect(rulesRefusal('badminton', { ...standardRules('badminton'), tie: { ...pbl, trumps: { A: 'MD' } } })?.error).toMatch(/picked by the teams/);
  });
});
