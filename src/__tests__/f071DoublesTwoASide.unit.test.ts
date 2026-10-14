/** F071 (launch test plan, Round 2): the server holds tennis and pickleball doubles to two a side, as badminton. */
import { doublesLineupProblem, standardRules, DOUBLES_PLAYERS } from '../utils/matchRules';
import fs from 'fs';
import path from 'path';

it.each(['tennis', 'pickleball'])('%s doubles: a third player is refused', (sport) => {
  expect(doublesLineupProblem(sport, { ...standardRules(sport), players: DOUBLES_PLAYERS } as never, { A: 3, B: 2 }, { A: 'Aces', B: 'Bees' }, 'lineup')).toBe('Doubles is two a side — Aces has 3.');
});
test('the line-up save checks it for all three', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(s).toContain('if (DOUBLES_SPORTS.includes(lineupSlug) && rules.players === DOUBLES_PLAYERS) {');
});
