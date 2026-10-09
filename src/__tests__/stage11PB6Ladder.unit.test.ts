/**
 * Stage 11 · PB6 · the server reads a technical foul's point off and a
 * forfeited game (11-0) the way the app does, and the timeline says each step
 * in the sport's own words.
 */
import { rollupSets } from '../controllers/scoring.controller';
import { setConfigOf, standardRules, ladderWords, CONDUCT_LADDERS } from '../utils/matchRules';
import { sportCommentary } from '../utils/commentary';

const sideOf = (p: any): 'A' | 'B' => (p?.team_side === 'B' ? 'B' : 'A');
const pt = (side: 'A' | 'B', n = 1) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, kind: 'point', value: 1 } }));
const note = (kind: string, side: 'A' | 'B') => ({ event_type: 'note', payload: { kind, team_side: side } });

describe('PB6 · the set rollup', () => {
  const cfg = setConfigOf(standardRules('pickleball'));
  it('a point off the offender (never below 0)', () => {
    const r = rollupSets(cfg, [...pt('A', 3), note('point_off', 'A'), note('point_off', 'B')], sideOf);
    expect([r.curA, r.curB]).toEqual([2, 0]);
  });
  it('a forfeited game goes to the other side 11-0; two end a best of 3', () => {
    const r = rollupSets(cfg, [...pt('B', 6), note('game_forfeit', 'B'), ...pt('A', 2), note('game_forfeit', 'B')], sideOf);
    expect(r.setScoresA).toEqual([11, 11]); expect(r.setScoresB).toEqual([0, 0]);
    expect(r.decided).toBe('A');
  });
  it('volleyball’s deciding set forfeits at 15', () => {
    const r = rollupSets(setConfigOf({ ...standardRules('volleyball'), bestOf: 3 }), [note('game_forfeit', 'A'), note('game_forfeit', 'B'), note('game_forfeit', 'A')], sideOf);
    expect(r.setScoresB).toEqual([25, 0, 15]);
  });
});

describe('PB6 · the timeline', () => {
  const ctx = (sport: string) => ({ sport, teamName: 'PYC', playerName: null } as any);
  it('names the step in the sport’s words', () => {
    expect(sportCommentary('note', { kind: 'violation', team_side: 'A', offence: 'conduct', penalty: 'foul' }, ctx('pickleball'))).toMatch(/technical foul$/);
    expect(sportCommentary('note', { kind: 'violation', team_side: 'A', offence: 'time', penalty: 'verbal' }, ctx('pickleball'))).toMatch(/verbal warning$/);
    expect(sportCommentary('note', { kind: 'violation', team_side: 'A', offence: 'time', penalty: 'game' }, ctx('tennis'))).toMatch(/game penalty$/);
    expect(sportCommentary('note', { kind: 'violation', team_side: 'A', offence: 'time', penalty: 'default' }, ctx('badminton'))).toMatch(/disqualification$/);
  });
  it('says what a point off and a game forfeit did', () => {
    expect(sportCommentary('note', { kind: 'point_off', team_side: 'A' }, ctx('pickleball'))).toMatch(/A point off/);
    expect(sportCommentary('note', { kind: 'game_forfeit', team_side: 'A' }, ctx('pickleball'))).toMatch(/Game forfeited by/);
  });
  it('the ladders are the same data as the app’s', () => {
    expect(ladderWords('pickleball', CONDUCT_LADDERS.pickleball!)).toBe('verbal warning, technical warning, technical foul, game forfeit, match forfeit');
  });
});
