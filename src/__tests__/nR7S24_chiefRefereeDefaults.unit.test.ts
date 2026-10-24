/** N-R7-S24 · a tournament's chief referee can give a walkover or a default on a fixture. */
import fs from 'fs';
import path from 'path';

test('completeMatch lets canDefault through for a walkover or a default on a tournament fixture', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(src).toContain("if (!system && !(await canOfficiateMatch(match, userId)) && !((walkoverIn === true || defaulted) && !!match.tournament_id && (await canDefault(match, userId)))) {");
});
test('canDefault counts the chief and deputy referee', () => {
  const src = fs.readFileSync(path.join(__dirname, '../utils/tournamentAuth.ts'), 'utf8');
  expect(src).toMatch(/\.in\('role', \['referee', 'umpire', 'chief_referee', 'deputy_referee', 'sector'\]\)/);
});
