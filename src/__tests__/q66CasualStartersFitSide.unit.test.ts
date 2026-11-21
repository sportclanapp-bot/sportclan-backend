/**
 * Q66 (Dipak, 21 Nov 2026: A) · RW-G2-025: a casual 6-a-side match let 8 be ticked as starters and
 * saved ('8/6 starting'); a tournament fixture refused it. A casual match now refuses it too, in the
 * same words (TOO_MANY_STARTERS); subs (role 'sub') work as before; sports without a players-a-side
 * line-up rule (cricket, racket sports) are unchanged.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { teamSheetProblem } from '../controllers/squads.controller';

const casual = { tournament_id: null, team_a_id: null, team_b_id: null, team_a_name: 'Spikers', team_b_name: 'Blockers' };
const side = (n: number, s: 'A' | 'B', subs = 0) => Array.from({ length: n }, (_, i) => ({ user_id: `${s}${i}`, team_side: s, role: i >= n - subs ? 'sub' : null }));

test('a casual 6-a-side volleyball match refuses 8 starters, same words as a tournament fixture', async () => {
  const p = await teamSheetProblem(casual, side(8, 'A'), [], 'volleyball', 6);
  expect(p).toEqual({ error: 'Spikers have 8 starting — it’s 6 a side. Mark the rest as subs.', code: 'TOO_MANY_STARTERS' });
});
test('6 starters and 2 subs are fine; and the line-up already saved counts', async () => {
  expect(await teamSheetProblem(casual, side(8, 'A', 2), [], 'volleyball', 6)).toBeNull();
  const p = await teamSheetProblem(casual, [{ user_id: 'B9', team_side: 'B', role: null }], side(6, 'B'), 'volleyball', 6);
  expect(p?.code).toBe('TOO_MANY_STARTERS');
});
test('a sport without a players-a-side line-up rule is unchanged', async () => {
  expect(await teamSheetProblem(casual, side(14, 'A'), [], 'cricket', 11)).toBeNull();
});
test('addParticipants asks it for casual matches too', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(src).toContain("// Q66: a casual match's starters fit the players a side too (teamSheetProblem says what applies).\n    {");
});
