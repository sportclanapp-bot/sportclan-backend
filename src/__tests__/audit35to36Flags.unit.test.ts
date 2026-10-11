/** Audit #35/#36 (11 Oct 2026): GET /matches/:id says can_cancel / can_void by the rules cancel and void enforce — an admin may void. */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
test('can_void is the void endpoint’s own check (organiser, umpire, creator — or an admin)', () => {
  expect(src).toMatch(/matchWithRating\.can_void = !!userId && await canVoidMatch\(match, userId\)/);
  expect(src).toMatch(/async function canVoidMatch[\s\S]{0,300}return isAdminUser\(userId\)/);
});
test('can_cancel: the organiser on a tournament fixture (not a knockout match), else the creator; never once finished', () => {
  expect(src).toMatch(/matchWithRating\.can_cancel = !!userId && !isTerminalMatchStatus\(match\.status\)\s*&& \(match\.tournament_id \? canManage === true && !koMatch : match\.created_by === userId\)/);
});
