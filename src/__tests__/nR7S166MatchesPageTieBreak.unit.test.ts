/**
 * N-R7-S166 (SCR-M-048, Step 2 B15): GET /matches?status=scheduled ordered by scheduled_at only, so rows
 * with the same kick-off time swapped across page edges: over 22 pages the server sent 6 rows twice and
 * the app's offset paging ended 3 upcoming matches short (2101 of 2104). Every list now ends its order
 * with id, so each page edge falls in the same place on every read.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');

it('the matches list breaks a scheduled_at / updated_at tie by id', () => {
  expect(src).toMatch(/: query\.order\('scheduled_at', \{ ascending: false, nullsFirst: false \}\);\s*(\/\/[^\n]*\n\s*)*query = query\.order\('id', \{ ascending: true \}\);/);
});
