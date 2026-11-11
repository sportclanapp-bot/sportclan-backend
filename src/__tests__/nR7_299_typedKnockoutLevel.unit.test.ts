/**
 * N-R7-299 / server half (Step 2 · Batch 12 · SIDE-C2b-1): a knockout semi whose rules keep the
 * default drawAllowed true took a level typed sheet (Q1–Q4 1–0, 0–1, 1–0, 0–1) and stayed LIVE at
 * 2–2. The typed-score endpoint now asks whether the fixture is a knockout one and refuses a
 * level sheet there, as for a no-draw match.
 */
import fs from 'fs';
import path from 'path';
import { typedPeriodPoints } from '../utils/typedScore';

const level = [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }, { a: 0, b: 1 }];
test('a level knockout typed sheet is refused; a league fixture may still draw', () => {
  expect(typedPeriodPoints('hockey', { periods: 4, drawAllowed: true } as never, level, { knockout: true }).problem).toBe('This match can’t end level — a level knockout goes to a shoot-out: score it on the pad.');
  expect(typedPeriodPoints('hockey', { periods: 4, drawAllowed: true } as never, level).draw).toBe(true);
});
test('the endpoint passes the fixture’s knockout flag', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(s).toContain('typedPeriodPoints(slug, prules, body.periods, { knockout: await isKnockoutBracketMatch({ ...(m as { tournament_id: string | null; round: number | null; group_label: string | null }), id }) })');
});
