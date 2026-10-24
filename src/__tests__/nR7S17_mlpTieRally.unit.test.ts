/** N-R7-S17 · an MLP tie (side-out doubles + a rally DreamBreaker) takes the pad's side-out 'rally' events. */
import fs from 'fs';
import path from 'path';
import { takesSideOutRally } from '../utils/sideOutRally';

const so11 = { scoring: 'sideout', bestOf: 1, target: 11 };
const MLP = { rubbers: [
  { key: 'WD', label: 'Women’s doubles', players: 2, rules: so11 }, { key: 'MD', label: 'Men’s doubles', players: 2, rules: so11 },
  { key: 'XD1', label: 'Mixed doubles 1', players: 2, rules: so11 }, { key: 'XD2', label: 'Mixed doubles 2', players: 2, rules: so11 },
  { key: 'DB', label: 'DreamBreaker', players: 1, decider: true, rules: { scoring: 'rally', bestOf: 1, target: 21 }, rotateEvery: 4 },
], win: 'first', repeatPlayers: true };

test('an MLP tie (rally at the top, side-out matches inside) takes a rally', () => {
  expect(takesSideOutRally('pickleball', { scoring: 'rally', tie: MLP } as never)).toBe(true);
});
test('a side-out match takes one; a rally match, an all-rally tie and other sports do not', () => {
  expect(takesSideOutRally('pickleball', { scoring: 'sideout' } as never)).toBe(true);
  expect(takesSideOutRally('pickleball', { scoring: 'rally' } as never)).toBe(false);
  expect(takesSideOutRally('pickleball', { scoring: 'rally', tie: { rubbers: [{ key: 'MS', rules: { scoring: 'rally', target: 15 } }], win: 'all' } } as never)).toBe(false);
  expect(takesSideOutRally('badminton', { scoring: 'sideout' } as never)).toBe(false);
  expect(takesSideOutRally('pickleball', null)).toBe(false);
});
test('the event gate uses it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain('if (!takesSideOutRally(slug, rulesOf(slug, match))) {');
});
