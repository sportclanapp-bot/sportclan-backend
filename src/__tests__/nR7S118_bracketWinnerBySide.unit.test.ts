/**
 * N-R7-S118 · Step 2 · Batch 8 · SPP1-CHS-047: a drawn knockout chess game decided on the Armageddon
 * draw, completed with winner_side 'B' (no winner_team_id), was refused 400 BRACKET_NEEDS_WINNER —
 * the bracket check read only winner_team_id. A winner side on a bracket match now names its team.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
test('the bracket check takes the winner side’s team before refusing', () => {
  const at = src.indexOf("code: 'BRACKET_NEEDS_WINNER'");
  const before = src.slice(at - 900, at);
  expect(before).toContain("if (isBracketMatch && !winner_team_id && (winnerSide === 'A' || winnerSide === 'B')) winner_team_id = (winnerSide === 'A' ? match.team_a_id : match.team_b_id) ?? undefined;");
  expect(before).toContain('if (isBracketMatch && !winner_team_id) {');
});
