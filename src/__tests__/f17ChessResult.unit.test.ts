/**
 * F-17 (MATCH_CREATE_TEST_PLAN): ending a chess game with no result silently
 * recorded a draw. completeMatch now refuses it (400 CHESS_RESULT_REQUIRED)
 * unless a result event exists, a winner is named, it is an explicit draw, or a
 * walkover.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
const i = src.indexOf('export async function completeMatch(');
const body = src.slice(i, src.indexOf('\nexport ', i + 10));

describe('F-17 · completeMatch needs a chess result', () => {
  const guard = body.indexOf("code: 'CHESS_RESULT_REQUIRED'");
  test('the refusal exists, keyed on the canonical chess result', () => {
    expect(guard).toBeGreaterThan(0);
    expect(body).toContain("!winnerSide && !is_draw && !walkover && normSportSlug(sportRow?.slug) === 'chess'");
    expect(body).toContain("!['White wins', 'Black wins', 'Draw'].includes(String(canonical?.chess?.result ?? ''))");
  });
  test('it runs before the draw fallthrough and before anything is written', () => {
    expect(guard).toBeLessThan(body.indexOf("code: 'NEEDS_DECISIVE_WINNER'"));
    expect(guard).toBeLessThan(body.indexOf("rpc('finalize_match'") > 0 ? body.indexOf("rpc('finalize_match'") : body.length);
  });
  test('the result strings match what recomputeSummary writes', () => {
    const scoring = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
    for (const r of ["chessResult = 'White wins'", "chessResult = 'Black wins'", "chessResult = 'Draw'"]) expect(scoring).toContain(r);
  });
});
