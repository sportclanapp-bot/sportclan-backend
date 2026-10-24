/** N-R7-S19 · a WPBL tie (timed rally matches inside a tie) takes TIME CALLED. */
import fs from 'fs';
import path from 'path';
import { tieHasTimedMatch } from '../utils/sideOutRally';

const timed15 = { scoring: 'rally', bestOf: 1, target: 25, winBy2: false, timeLimitMinutes: 15, timedLevel: 'draw' };
const WPBL = { rubbers: [{ key: 'MS', players: 1, rules: timed15 }, { key: 'WS', players: 1, rules: timed15 }, { key: 'DEC', players: 2, decider: true, rules: { scoring: 'rally', bestOf: 1, target: 7, winBy2: false } }], win: 'all' };

test('a tie with a timed match is timed; an untimed tie or match is not', () => {
  expect(tieHasTimedMatch({ tie: WPBL } as never)).toBe(true);
  expect(tieHasTimedMatch({ tie: { rubbers: [{ key: 'MS', players: 1, rules: { target: 15 } }], win: 'all' } } as never)).toBe(false);
  expect(tieHasTimedMatch({ timeLimitMinutes: 15 } as never)).toBe(false);
  expect(tieHasTimedMatch(null)).toBe(false);
});
test('the buzzer gate uses it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain('|| tieHasTimedMatch(rulesOf(slug, match))');
});
