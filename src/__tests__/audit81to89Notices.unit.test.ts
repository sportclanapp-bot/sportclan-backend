/**
 * Audit #81, #82, #86–#89 (11 Oct 2026) — result and reminder messages. The
 * real messages are checked on the local server in batch3-checks.mjs (s81 s82
 * s86 — every sport); this pins the rules in the code.
 */
import fs from 'fs';
import path from 'path';
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { matchNamesForNotice } from '../utils/matchNames';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');

test('#81 the push body is the stored sentence, after every step that can change it', () => {
  expect(src).toMatch(/resultForNotice = typeof ss\.result === 'string' && ss\.result \? ss\.result : resultForNotice;\s*\/\/ Audit #56/);
});
test('#82 every finish is told (no "if (!walkover)")', () => {
  expect(src).not.toMatch(/if \(!walkover\) \{\s*try \{\s*const \[players, followers\]/);
});
test('#86 the official is the sport’s own word', () => {
  expect(src).toMatch(/title: `Rate your \$\{offWord\}`/);
});
test('#88 no "rating rating updated"', () => {
  expect(src).not.toMatch(/let sportName = 'rating'/);
  expect(src).toMatch(/title: sportName \? `\$\{sportName\} rating updated` : 'Rating updated'/);
});
test('#87 / #89 a match’s name: typed names, else the registered teams; null if a side has none', async () => {
  db = fakeDb({ teams: [{ id: 't1', name: 'Lions' }, { id: 't2', name: 'Tigers' }] });
  expect(await matchNamesForNotice({ team_a_id: 't1', team_b_id: 't2', team_a_name: null, team_b_name: null })).toBe('Lions vs Tigers');
  expect(await matchNamesForNotice({ team_a_name: 'Reds', team_b_name: 'Blues' })).toBe('Reds vs Blues');
  expect(await matchNamesForNotice({ team_a_name: null, team_b_name: null })).toBeNull();
});
