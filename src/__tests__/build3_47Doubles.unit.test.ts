/** BUILD 3.47 · badminton doubles is exactly two a side (the shared rule the server checks with). */
import fs from 'fs';
import path from 'path';
import { DOUBLES_PLAYERS, doublesLineupProblem, rulesRefusal, standardRules } from '../utils/matchRules';

const doubles = { ...standardRules('badminton'), players: DOUBLES_PLAYERS };
const names = { A: 'Smashers', B: 'Drops' };

test('the rule', () => {
  expect(rulesRefusal('badminton', doubles)).toBeNull();
  expect(rulesRefusal('badminton', { ...doubles, players: 4 })?.field).toBe('players');
  expect(doublesLineupProblem('badminton', doubles, { A: 2, B: 3 }, names, 'lineup')).toBe('Doubles is two a side — Drops has 3.');
  expect(doublesLineupProblem('badminton', doubles, { A: 1, B: 2 }, names, 'start')).toBe('Doubles is two a side — Smashers needs a partner in the line-up.');
  expect(doublesLineupProblem('badminton', doubles, { A: 0, B: 0 }, names, 'start')).toBeNull();
});

test('checked on a line-up, before the first point, and on an open doubles game', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '../controllers', f), 'utf8');
  const matches = read('matches.controller.ts');
  expect(matches).toContain("{ A: (match.team_a_name as string | null) ?? 'Team A', B: (match.team_b_name as string | null) ?? 'Team B' }, 'lineup');");
  expect(matches).toContain('players_needed > DOUBLES_PLAYERS * 2 - 1');
  expect(read('scoring.controller.ts')).toContain("{ A: match.team_a_name ?? 'Team A', B: match.team_b_name ?? 'Team B' }, 'start');");
});
