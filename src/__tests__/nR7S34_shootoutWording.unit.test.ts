/** N-R7-S34 · Step 2 · Batch 12 · SPP2-HOC-048: the level-game refusal read "a shoot-out decide it first". */
import fs from 'fs';
import path from 'path';

test('a level hockey series game: "a shoot-out decides it first"; football keeps "penalties decide it first"', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).not.toContain("'a shoot-out' : 'penalties'} decide it first");
  expect(src).toContain("`The game is level — ${slug === 'hockey' ? 'a shoot-out decides' : 'penalties decide'} it first.`");
});
