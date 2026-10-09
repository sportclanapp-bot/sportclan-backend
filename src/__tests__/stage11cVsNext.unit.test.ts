/**
 * Stage 11 follow-up · USA Pickleball 15.B.4's 4th step: point difference
 * against the next-placed team. A group of five: T beats everyone; X, Y and Z
 * beat each other in a circle by 2 each and all beat W, so they're level on
 * wins, head-to-head, point difference (+4 each) and point difference between
 * them. Against T — the highest-placed team outside the tie — X lost by 2, Y by
 * 4, Z by 6: X, Y, Z. Points scored would have put them Z, X, Y.
 */
import { rankTeams, pointsFor, type GMatch } from '../utils/standings';
import { tiebreakPresetsFor, tiebreakLabel, tiebreakRefusal, tiebreaksFor } from '../utils/tournamentSettings';

const g = (a: string, b: string, sa: number, sb: number): GMatch => ({
  team_a_id: a, team_b_id: b, winner_team_id: sa > sb ? a : b, status: 'completed',
  score_summary: { A: { score: sa > sb ? 1 : 0, sets: [sa] }, B: { score: sb > sa ? 1 : 0, sets: [sb] } },
});
const ms: GMatch[] = [
  g('T', 'X', 11, 9), g('T', 'Y', 11, 7), g('T', 'Z', 11, 5), g('T', 'W', 11, 0),
  g('X', 'Y', 11, 9), g('Y', 'Z', 21, 19), g('Z', 'X', 23, 21),
  g('X', 'W', 11, 5), g('Y', 'W', 11, 3), g('Z', 'W', 11, 1),
];
const ids = ['W', 'X', 'Y', 'Z', 'T'];
const pts = pointsFor('pickleball');
const usap = tiebreakPresetsFor('pickleball').find((p) => p.key === 'usap')!.order;

describe('point difference against the next-placed team', () => {
  it('the USA Pickleball preset has it 4th, before points scored', () => {
    expect(usap).toEqual(['head_to_head', 'points_diff', 'h2h_points_diff', 'points_diff_vs_next', 'points_won']);
    expect(tiebreakRefusal('pickleball', usap)).toBeNull();
    expect(tiebreakLabel('pickleball', 'points_diff_vs_next')).toBe('Points difference against the next-placed');
    expect(tiebreakLabel('tennis', 'points_diff_vs_next')).toBe('Game difference against the next-placed');
    expect(tiebreaksFor('football')).not.toContain('points_diff_vs_next');
  });
  it('it decides the group: X, Y, Z (by their results against T)', () => {
    expect(rankTeams(ids, ms, usap, pts)).toEqual(['T', 'X', 'Y', 'Z', 'W']);
  });
  it('without it, points scored would have: Z, X, Y', () => {
    expect(rankTeams(ids, ms, usap.filter((t) => t !== 'points_diff_vs_next'), pts)).toEqual(['T', 'Z', 'X', 'Y', 'W']);
  });
  it('level against the top team → the next one down (T2) decides', () => {
    // T1 beats everyone; T2 beats all but T1. X, Y, Z all lose 7-11 to T1 (level),
    // to T2 by 2 / 4 / 6, and beat W by 6 / 8 / 10: every other measure level.
    const six: GMatch[] = [
      g('T1', 'T2', 11, 9), g('T1', 'X', 11, 7), g('T1', 'Y', 11, 7), g('T1', 'Z', 11, 7), g('T1', 'W', 11, 0),
      g('T2', 'X', 11, 9), g('T2', 'Y', 11, 7), g('T2', 'Z', 11, 5), g('T2', 'W', 11, 0),
      g('X', 'Y', 11, 9), g('Y', 'Z', 21, 19), g('Z', 'X', 23, 21),
      g('X', 'W', 11, 5), g('Y', 'W', 11, 3), g('Z', 'W', 11, 1),
    ];
    const all = ['W', 'X', 'Y', 'Z', 'T1', 'T2'];
    expect(rankTeams(all, six, usap, pts)).toEqual(['T1', 'T2', 'X', 'Y', 'Z', 'W']);
    expect(rankTeams(all, six, usap.filter((t) => t !== 'points_diff_vs_next'), pts).slice(2, 5)).toEqual(['Z', 'X', 'Y']);
  });
});
