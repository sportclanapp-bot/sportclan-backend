/**
 * Audit #1–#3 (11 Oct 2026): a person's sports came back in whatever order the
 * database gave (no ORDER BY), so "the first of your sports" was random. They
 * come back in the app's display order (Cricket first), on /users/me, on a
 * public profile and after saving.
 */
import fs from 'fs';
import path from 'path';
import { inDisplayOrder } from '../utils/userSports';

test('display order, ties kept in their order', () => {
  expect(inDisplayOrder([{ sport_id: 'basketball', order: 10 }, { sport_id: 'hockey', order: 11 }, { sport_id: 'badminton', order: 2 }, { sport_id: 'cricket', order: 1 }]))
    .toEqual(['cricket', 'badminton', 'basketball', 'hockey']);
  expect(inDisplayOrder([{ sport_id: 'x', order: null }, { sport_id: 'cricket', order: 1 }])).toEqual(['cricket', 'x']);
});
test('getMe, the public profile and the save all use it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/users.controller.ts'), 'utf8');
  expect(src).toMatch(/safe\(orderedSportIds\(userId\), \[\] as string\[\]\)/);
  expect(src).toMatch(/safeUser\.sport_ids = await profileSportIds\(id\)/);
  expect(src).toMatch(/valid = inDisplayOrder\(/);
  expect(src).not.toMatch(/from\('user_sports'\)\.select\('sport_id'\)\.eq\('user_id', userId\)\n\s*\.then/);
});
