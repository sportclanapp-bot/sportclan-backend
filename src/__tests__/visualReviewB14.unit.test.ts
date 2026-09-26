/** Visual review B14 (backend) · V048 (D19): a new account's DOB starts hidden. */
import fs from 'fs';
import path from 'path';

it('register inserts show_dob: false', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/auth.controller.ts'), 'utf8');
  const i = s.indexOf(".from('users')\n    .insert({");
  expect(i).toBeGreaterThan(-1);
  expect(s.slice(i, i + 900)).toMatch(/show_dob: false,/);
});
