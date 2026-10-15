/**
 * F093 (launch test plan, Round 3): a QR hand-off's result travelled as the winning TEAM only — a
 * match between typed-in names went in as a draw, and a shoot-out / super over / DLS / chess tie-break
 * was lost. The result op carries how it ended (`c`), checked as narrowly as the rest.
 */
import { completeFieldsOf, isResultOp } from '../utils/qrHandoff';
import fs from 'fs';
import path from 'path';

const op = (r: object) => ({ k: 'k', s: 1, t: 'result', r }) as never;
test('a side, a shoot-out, a super over, DLS, a chess tie-break: accepted', () => {
  expect(isResultOp(op({ w: null, c: { side: 'A' } }))).toBe(true);
  expect(isResultOp(op({ w: null, c: { side: 'B', so: { A: 3, B: 4 } } }))).toBe(true);
  expect(isResultOp(op({ w: null, c: { side: 'A', sov: { A: 12, B: 9 }, tf: 'boundaries' } }))).toBe(true);
  expect(isResultOp(op({ w: null, c: { side: 'A', un: 'dls' } }))).toBe(true);
  expect(isResultOp(op({ w: null, c: { side: 'B', ct: { method: 'armageddon', armageddon: 'draw' } } }))).toBe(true);
});
test('anything else in c refuses the op', () => {
  expect(isResultOp(op({ w: null, c: { side: 'C' } }))).toBe(false);
  expect(isResultOp(op({ w: null, c: { round: 2 } }))).toBe(false);
  expect(isResultOp(op({ w: null, c: { so: { A: -1, B: 2 } } }))).toBe(false);
  expect(isResultOp(op({ w: null, c: { so: { A: 1, B: 2, C: 3 } } }))).toBe(false);
  expect(isResultOp(op({ w: null, c: { ct: { method: 'coin' } } }))).toBe(false);
});
test('the completion gets the same fields the queue sends; a side is no draw', () => {
  expect(completeFieldsOf({ side: 'A', so: { A: 4, B: 3 }, un: 'award' })).toEqual({ winner_side: 'A', shootout: { A: 4, B: 3 }, unfinished: 'award' });
  const s = fs.readFileSync(path.join(__dirname, '../controllers/qrHandoff.controller.ts'), 'utf8');
  expect(s).toContain('is_draw: op.r.w === null && !op.r.c?.side,');
  expect(s).toContain('...completeFieldsOf(op.r.c),');
});
