/**
 * Oct 2026 (Dipak) · a Swiss's rounds: 2 up to one fewer than its players —
 * no fixed top of 11. Checked against the size on create and edit, and against
 * the real field at the draw (as before).
 */
import { swissRoundsProblem, swissRoundsFor, settingsRefusal } from '../utils/tournamentSettings';
import * as fs from 'fs';
import * as path from 'path';

test('2 up to players − 1', () => {
  expect(swissRoundsProblem(2, 3)).toBeNull();
  expect(swissRoundsProblem(20, 32)).toBeNull();
  expect(swissRoundsProblem(31, 32)).toBeNull();
  expect(swissRoundsProblem(32, 32)).toBe('32 players can play at most 31 Swiss rounds without meeting twice.');
  expect(swissRoundsProblem(1, 32)).toBe('A Swiss has at least 2 rounds.');
  expect(swissRoundsProblem(2.5)).toBe('A Swiss has at least 2 rounds.');
  expect(swissRoundsProblem(40)).toBeNull(); // size not known yet: only the minimum
  expect(settingsRefusal('chess', 'swiss', { swiss: { rounds: 15 } })).toBeNull();
});

test('the suggestion: log₂ N + 1, never past N − 1 (and no top of 11)', () => {
  expect(swissRoundsFor(3)).toBe(2);
  expect(swissRoundsFor(4)).toBe(3);
  expect(swissRoundsFor(8)).toBe(4);
  expect(swissRoundsFor(1000)).toBe(11);
  expect(swissRoundsFor(5000)).toBe(14);
});

test('create and edit check the rounds against max_teams', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'tournaments.controller.ts'), 'utf8');
  expect(src).toContain("const rBad = swissRoundsProblem((settings as { swiss?: { rounds?: unknown } }).swiss?.rounds, players);");
  expect(src).toContain('const rBad = swissRoundsProblem(sw.rounds, Number.isInteger(players) ? players : null);');
});
