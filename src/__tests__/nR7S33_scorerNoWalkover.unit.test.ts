/**
 * N-R7-S33 · Step 2 · Batch 11 · SPP2-BAS-085: a walkover on a tournament fixture is the
 * referee's (Commissioner), umpire's or organiser's decision. A plain tournament Scorer gave
 * one through the API (200). The match page also says who may (can_default), so the app can
 * offer the Walkover button only to them.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
test('completeMatch refuses a plain scorer\'s walkover on a tournament fixture', () => {
  expect(src).toContain("if (!system && walkoverIn === true && !retired && !defaulted && !!match.tournament_id && !(await canDefault(match, userId))) {");
  expect(src).toContain("code: 'NOT_REFEREE_WALKOVER'");
});
test('the match page carries can_default', () => {
  expect(src).toMatch(/matchWithRating\.can_default = /);
});
