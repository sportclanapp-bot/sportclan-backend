/** N-R7-S23 · carrom: undoing the only slam takes the slam count away (the summary kept 'Slams 1–0'). */
import fs from 'fs';
import path from 'path';

test('the summary drops slams when the events have none (it is rebuilt over the stored one)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain('const summary: Record<string, any> = { ...existing, A, B };'); // the stored summary is the base …
  expect(src).toContain('if (carromSlams) summary.slams = carromSlams; else delete summary.slams;'); // … so a count with no slams left must be removed
});
