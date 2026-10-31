/**
 * N-R7-71 (Step 2 Batch 5, RW-D2-106): the refusal said 'Set the lineup first.' while the card beside it
 * says 'line-up' ('Nobody is in the line-up yet …'). The server's words now say line-up too.
 */
import fs from 'fs';
import path from 'path';
test("the ranked no-line-up refusal says 'line-up'", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
  expect(src).toContain('Ranked matches need at least one registered player on each side. Set the line-up first.');
  expect(src).not.toContain('Set the lineup first.');
});
