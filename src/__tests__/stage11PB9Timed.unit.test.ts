/**
 * Stage 11 · PB9 · the server reads a timed rally match the way the app does:
 * the side ahead at the buzzer (games, then points in the game in play) wins;
 * level, the next point — or, under "stays level", a draw the completion
 * accepts (bestOfState: decided, no leader). A knockout fixture always plays
 * the next point.
 */
import { rollupSets, bestOfState } from '../controllers/scoring.controller';
import { fixtureRulesFor } from '../controllers/tournaments.controller';
import { setConfigOf, standardRules } from '../utils/matchRules';

const sideOf = (p: any): 'A' | 'B' => (p?.team_side === 'B' ? 'B' : 'A');
const pt = (side: 'A' | 'B', n = 1) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, kind: 'point', value: 1 } }));
const buzzer = { event_type: 'note', payload: { kind: 'buzzer' } };
const cfg1 = setConfigOf({ ...standardRules('pickleball'), bestOf: 1, target: 99 });

describe('PB9 · rollupSets', () => {
  it('ahead on points at the buzzer: that side, the game recorded', () => {
    const r = rollupSets(cfg1, [...pt('A', 9), ...pt('B', 7), buzzer, ...pt('B', 5)], sideOf, { level: 'next_point' });
    expect(r.decided).toBe('A'); expect(r.setScoresA).toEqual([9]); expect(r.setScoresB).toEqual([7]); expect(r.setsA).toBe(1);
    expect(r.buzzer).toBe(true);
  });
  it('level, next point: the first point after decides', () => {
    const r = rollupSets(cfg1, [...pt('A', 6), ...pt('B', 6), buzzer, ...pt('B'), ...pt('A', 3)], sideOf, { level: 'next_point' });
    expect(r.decided).toBe('B'); expect(r.setScoresB).toEqual([7]);
  });
  it('level, stays level: a draw at 16-16', () => {
    const r = rollupSets(cfg1, [...pt('A', 16), ...pt('B', 16), buzzer, ...pt('A')], sideOf, { level: 'draw' });
    expect(r.decided).toBeNull(); expect(r.level).toBe(true); expect(r.setScoresA).toEqual([16]); expect(r.setScoresB).toEqual([16]);
  });
  it('ahead on games: a partial game is recorded but not counted', () => {
    const cfg = setConfigOf({ ...standardRules('pickleball') });
    const r = rollupSets(cfg, [...pt('A', 11), ...pt('B', 5), buzzer], sideOf, { level: 'next_point' });
    expect(r.decided).toBe('A'); expect([r.setsA, r.setsB]).toEqual([1, 0]); expect(r.setScoresB).toEqual([0, 5]);
  });
  it('an untimed match ignores a buzzer', () => {
    const r = rollupSets(setConfigOf(standardRules('pickleball')), [...pt('A', 3), buzzer], sideOf);
    expect(r.decided).toBeNull(); expect(r.curA).toBe(3);
  });
});

describe('PB9 · completing', () => {
  const m = { rules: { ...standardRules('pickleball'), bestOf: 1, timeLimitMinutes: 15, timedLevel: 'draw' } };
  it('a draw at the buzzer is decided with no leader; a lead at the buzzer is that side', () => {
    expect(bestOfState('pickleball', { A: { score: 0, sets: [16] }, B: { score: 0, sets: [16] }, buzzer: true, timed_level: true }, m)).toMatchObject({ decided: true, leader: null });
    expect(bestOfState('pickleball', { A: { score: 1, sets: [9] }, B: { score: 0, sets: [7] }, buzzer: true }, m)).toMatchObject({ decided: true, leader: 'A' });
    expect(bestOfState('pickleball', { A: { score: 0, points: 6 }, B: { score: 0, points: 6 }, buzzer: true }, m)).toMatchObject({ decided: false });
  });
  it('a knockout fixture plays the next point; a group fixture keeps "stays level"', () => {
    const t = { default: { ...standardRules('pickleball'), timeLimitMinutes: 15, timedLevel: 'draw' } };
    expect(fixtureRulesFor('pickleball', t, 'group', null)).toMatchObject({ timedLevel: 'draw' });
    expect(fixtureRulesFor('pickleball', t, 'knockout', null)).toMatchObject({ timedLevel: 'next_point' });
    expect(fixtureRulesFor('pickleball', t, 'final', null)).toMatchObject({ timedLevel: 'next_point' });
  });
});
