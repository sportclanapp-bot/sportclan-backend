/** Audit #131, #132, #134 (11 Oct 2026, server): the same words as the app. */
import fs from 'fs';
import path from 'path';
import { deriveResultText } from '../utils/matchResult';
import { scorePush } from '../utils/scorePush';

test('#131 a level result: "Tied" for cricket, "Draw" for the rest (a timed badminton match said "Tied")', () => {
  const lvl = (sport: string) => deriveResultText({ sport, teamAName: 'A', teamBName: 'B', aScore: 3, bScore: 3 } as never).text;
  expect([lvl('cricket'), lvl('football'), lvl('badminton'), lvl('chess'), lvl('tabletennis')]).toEqual(['Tied', 'Draw', 'Draw', 'Draw', 'Draw']);
});

test('#132 round names: "Semi-final" / "Quarter-final" ("Group Stage" stays — 2.15.0 reads it as a key)', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
  expect(s).not.toMatch(/'Semi-Finals'|'Quarter-Finals'/);
  expect(s).toContain("if (fromEnd === 1) return 'Semi-final';");
  expect(s).toContain("if (r === 0) return 'Group Stage';");
});

test('#134 the goal push: "2–1" with an en dash', () => {
  const p = scorePush({ slug: 'football', kind: 'goal', teamName: 'Lions', summary: { A: { score: 2 }, B: { score: 1 } } } as never);
  expect(p?.body).toBe('Lions scores! 2–1');
});
