/** Audit #37 (11 Oct 2026): GET /tournaments/:id says whether the viewer organises it, so a co-organiser's controls show at once. */
import fs from 'fs';
import path from 'path';

test('the tournament carries can_manage from isTournamentOrganiser', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function getTournament('), src.indexOf('\nexport ', src.indexOf('export async function getTournament(') + 10));
  expect(fn).toMatch(/const organiser = await isTournamentOrganiser\(id, userId\)/);
  expect(fn).toMatch(/tournament: \{ \.\.\.tournament, can_manage: organiser === true \}/);
});
