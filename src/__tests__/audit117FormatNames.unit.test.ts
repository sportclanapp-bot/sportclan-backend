/** Audit #117 / #115–#120 (11 Oct 2026): the server names formats from the shared file, never "bo3" / "box". */
import fs from 'fs';
import path from 'path';
import { matchFormatName } from '../utils/displayNames';

test('advanced stats split formats by name; a sport-name format is no format', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/advancedStats.controller.ts'), 'utf8');
  expect(s).toContain('const fmtName = matchFormatName(m.format as string | null, { unit: unitOf });');
  expect(s).not.toContain('bump(acc.fmt, String(m.format), won)');
  expect([matchFormatName('bo3'), matchFormatName('bo3', { unit: 'set' }), matchFormatName('box'), matchFormatName('hockey')]).toEqual(['Best of 3', 'Best of 3 sets', 'Box cricket', null]);
});

test('displayNames.ts is byte-for-byte the app’s', () => {
  const app = path.join(__dirname, '../../../sportclan-v2/src/utils/displayNames.ts');
  if (!fs.existsSync(app)) return; // the app repo isn't beside this one (CI)
  expect(fs.readFileSync(path.join(__dirname, '../utils/displayNames.ts'), 'utf8')).toBe(fs.readFileSync(app, 'utf8'));
});
