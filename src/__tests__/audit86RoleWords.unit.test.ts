/** Audit #86 (11 Oct 2026): the "you're a tournament official" notice said "assigned as chief_referee" — now the sport's words. */
import fs from 'fs';
import path from 'path';
import { officialRoleLabel } from '../utils/officialRoleLabel';

test('stored roles read in each sport’s words', () => {
  expect(officialRoleLabel('chess', 'chief_referee')).toBe('Chief arbiter');
  expect(officialRoleLabel('chess', 'pairings')).toBe('Pairings arbiter');
  expect(officialRoleLabel('cricket', 'chief_referee')).toBe('Match referee');
  expect(officialRoleLabel('cricket', 'umpire')).toBe('Umpire');
  expect(officialRoleLabel('football', 'referee')).toBe('Referee');
  expect(officialRoleLabel('chess', 'referee')).toBe('Arbiter');
  expect(officialRoleLabel('badminton', 'deputy_referee')).toBe('Deputy referee');
  expect(officialRoleLabel('football', 'scorer')).toBe('Scorer');
});

test('the notice uses the words, never the key', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/features.controller.ts'), 'utf8');
  expect(s).not.toContain('You were assigned as ${role} for');
  expect(s).toContain('const roleWords = officialRoleLabel(slug, role);');
});
