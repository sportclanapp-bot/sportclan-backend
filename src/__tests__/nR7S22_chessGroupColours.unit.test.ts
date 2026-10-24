/** N-R7-S22 · chess groups and boxes: colours as even as a round robin allows (the top seed had White in all 3). */
import fs from 'fs';
import path from 'path';
import { balanceColours, seededGroupFixtures } from '../utils/groupOrder';

const tally = (games: Array<{ a: string; b: string }>) => { const c: Record<string, string> = {}; for (const g of games) { c[g.a] = (c[g.a] ?? '') + 'W'; c[g.b] = (c[g.b] ?? '') + 'B'; } return c; };
test('a group of 4: everyone 2/1 or 1/2, never three of a colour', () => {
  const games = balanceColours(seededGroupFixtures([['p1', 'p2', 'p3', 'p4']]), (x) => x);
  const c = tally(games);
  for (const s of Object.values(c)) { const w = s.split('W').length - 1; expect([1, 2]).toContain(w); expect(s).not.toMatch(/WWW|BBB/); }
});
test('two groups of 3: everyone 1/1; the pairings themselves unchanged', () => {
  const raw = seededGroupFixtures([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']]);
  const games = balanceColours(raw, (x) => x);
  for (const s of Object.values(tally(games))) expect(s.split('').sort().join('')).toBe('BW');
  expect(games.map((g) => [g.a, g.b].sort().join())).toEqual(raw.map((g) => [g.a, g.b].sort().join()));
});
test('the draw uses it for chess groups and boxes', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
  expect(src).toContain('groupChess ? balanceColours(groupGames, (x) => x.id) : groupGames');
  expect(src).toContain('boxChess ? balanceColours(boxGames, (x) => x.teamId) : boxGames');
});
test('without it the seeded order gives the top seed White in every game (the bug)', () => {
  const c = tally(seededGroupFixtures([['p1', 'p2', 'p3', 'p4']]));
  expect(c.p1).toBe('WWW');
});
