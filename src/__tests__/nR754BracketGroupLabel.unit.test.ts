/**
 * N-R7-54 (Step 2 · Batch 2 R5): the bracket sent a groups → knockout's group games without their
 * group, so the app couldn't list them under "GROUP A" / "GROUP B" (it drew them as a knockout round).
 */
import fs from 'fs';
import path from 'path';

const s = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'tournaments.controller.ts'), 'utf8');
test('a group game in the bracket carries its group label (groups → knockout as well as a box league)', () => {
  expect(s).toMatch(/\(fmtLc === 'box' \|\| fmtLc === 'groups_knockout'\) && m\.group_label \? \{ group_label: m\.group_label \}/);
});
