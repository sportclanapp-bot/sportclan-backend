import { CHESS_RESULT_REASONS, isValidChessReason, flagFallen } from '../utils/chessRules';
const CORE_REL = 'utils/chessRules.ts';
const OTHER_REPO = '../sportclan-v2';
const OTHER_CORE_REL = 'src/scoring/chessRules.ts';
/**
 * The shared chess result rule (decision A3), held to ONE fixture table in both
 * repos. chessRules.ts is byte-identical in the app and the server; this test
 * body is identical too (only the import path differs).
 */
import fs from 'fs';
import path from 'path';

describe('chessRules', () => {
  test('reasons: three decisive, five draws (incl. insufficient material, 50-move)', () => {
    expect(CHESS_RESULT_REASONS.decisive.map((r) => r.id)).toEqual(['checkmate', 'resignation', 'timeout']);
    expect(CHESS_RESULT_REASONS.draw.map((r) => r.id)).toEqual(['draw_agreement', 'stalemate', 'repetition', 'insufficient_material', 'fifty_move']);
  });
  test('a reason must fit the result', () => {
    expect(isValidChessReason('white', 'checkmate')).toBe(true);
    expect(isValidChessReason('black', 'timeout')).toBe(true);
    expect(isValidChessReason('draw', 'fifty_move')).toBe(true);
    expect(isValidChessReason('draw', 'insufficient_material')).toBe(true);
    expect(isValidChessReason('draw', 'checkmate')).toBe(false);
    expect(isValidChessReason('white', 'stalemate')).toBe(false);
    expect(isValidChessReason('white', 'made up')).toBe(false);
    expect(isValidChessReason('white', undefined)).toBe(true);
  });
  test('a flag falls at 0:00', () => {
    expect(flagFallen(0)).toBe(true);
    expect(flagFallen(-2)).toBe(true);
    expect(flagFallen(0.4)).toBe(false);
  });

  const here = path.join(__dirname, '..', CORE_REL);
  const there = path.join(__dirname, '..', '..', OTHER_REPO, OTHER_CORE_REL);
  (fs.existsSync(there) ? test : test.skip)('the app and server copies are identical', () => {
    expect(fs.readFileSync(here, 'utf8')).toBe(fs.readFileSync(there, 'utf8'));
  });
});

describe('A3 on the server', () => {
  test('a result with a reason outside the list is refused', () => {
    const sc = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
    expect(sc).toMatch(/!isValidChessReason\(payload\.winner, payload\.reason\)[\s\S]{0,200}BAD_CHESS_REASON/);
  });
});
