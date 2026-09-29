/**
 * BUILD 2.3 · the server scores by the match's rules (matchRules, shared with
 * the app): the rally rollup, tennis, carrom and best-of completion read
 * `rulesOf(match)` — the standards for a match stored before rules were data.
 */
import fs from 'fs';
import path from 'path';
import { SET_CONFIG, rollupSets, bestOfState } from '../controllers/scoring.controller';
import { rulesOf, setConfigOf, standardRules } from '../utils/matchRules';
import { carromReplay } from '../utils/carromCore';

const pts = (side: 'A' | 'B', n: number) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, value: 1 } }));
const sideOf = (p: { team_side: 'A' | 'B' }) => p.team_side;

describe('BUILD 2.3 · server engines follow the rules', () => {
  test('SET_CONFIG is the shared standards, not a copy', () => {
    for (const sport of Object.keys(SET_CONFIG)) expect(SET_CONFIG[sport]).toEqual(setConfigOf(standardRules(sport)));
  });
  test('a badminton game to 15 (no cap, 1 game) ends at 15; a standard one doesn’t', () => {
    const custom = setConfigOf(rulesOf('badminton', { rules: { ...standardRules('badminton'), target: 15, cap: null, bestOf: 1 } }));
    expect(rollupSets(custom, pts('A', 15), sideOf).decided).toBe('A');
    const std = setConfigOf(rulesOf('badminton', { format: 'badminton' }));
    expect(rollupSets(std, pts('A', 15), sideOf).decided).toBeNull();
  });
  test('win by 1 when the rules say so', () => {
    const cfg = setConfigOf(rulesOf('tabletennis', { rules: { ...standardRules('tabletennis'), bestOf: 1, winBy2: false } }));
    expect(rollupSets(cfg, [...pts('A', 10), ...pts('B', 10), ...pts('A', 1)], sideOf).decided).toBe('A');
  });
  test('best-of completion reads the rules, or an older caller’s format', () => {
    expect(bestOfState('badminton', { A: { score: 1 }, B: { score: 0 } }, { rules: { ...standardRules('badminton'), bestOf: 1 } })?.decided).toBe(true);
    expect(bestOfState('badminton', { A: { score: 1 }, B: { score: 0 } }, 'bo3')?.decided).toBe(false);
    expect(bestOfState('football', {}, null)).toBeNull();
  });
  test('carrom: the game target is a parameter (25 standard)', () => {
    const b = [{ winner: 'A' as const, piecesLeft: 9, queen: true }, { winner: 'A' as const, piecesLeft: 9, queen: true }];
    expect(carromReplay(b, 1, 29).winner).toBeNull();
    expect(carromReplay([...b, { winner: 'A' as const, piecesLeft: 1, queen: false }], 1).winner).toBe('A');
  });
  test('recompute and completion read the match’s rules', () => {
    const sc = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
    expect(sc).toContain("select('sport_id, score_summary, format, overs, rules')");
    expect(sc).toContain('const cfg = setConfigOf(rulesOf(slug, match));');
    expect(sc).toContain("rulesOf('carrom', match).target");
    const mc = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    expect(mc).toContain("overs: rulesOf('cricket', match).overs ?? null");
  });
});
