/**
 * N-R7-59 (Step 2 · Batch 2 R5): a cricket final played as a best-of-3 series (A won 2–1) crowned A
 * with 'beat B 12–10 in the final' — the bracket sent the last game's runs as the final's score.
 * A series fixture's score in the bracket is the games won.
 */
import fs from 'fs';
import path from 'path';

const s = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'tournaments.controller.ts'), 'utf8');
test('a series fixture in the bracket scores games won, not the last game’s runs', () => {
  expect(s).toMatch(/const seriesTie = ss\?\.tie\?\.series === true \? ss\.tie : null;/);
  expect(s).toMatch(/score_a: seriesTie \? Number\(seriesTie\.rubbersA \?\? 0\) : ss\.team_a_score/);
  expect(s).toMatch(/score_b: seriesTie \? Number\(seriesTie\.rubbersB \?\? 0\) : ss\.team_b_score/);
});
