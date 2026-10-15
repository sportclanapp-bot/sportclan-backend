/**
 * F120 (launch test plan, Round 3): teams added or approved at the same moment took a tournament past
 * its maximum. Migration 157's trigger refuses the approval past it with the tournament's row lock held;
 * every way in answers that refusal as 'Tournament is full'. (The race itself: verify/proofs/F120.proof.mjs
 * on the local stack — 4 of 4 approved without the trigger, 2 with it.)
 */
import fs from 'fs';
import path from 'path';
import { isEntryCapError, ENTRY_CAP_BODY } from '../utils/entryCap';

test('the trigger’s refusal, as supabase-js reports it', () => {
  expect(isEntryCapError({ code: 'P0001', message: 'TOURNAMENT_FULL', details: 'Tournament is full' })).toBe(true);
  expect(isEntryCapError({ code: '23505', message: 'duplicate key' })).toBe(false);
  expect(isEntryCapError(null)).toBe(false);
  expect(ENTRY_CAP_BODY).toEqual({ error: 'Tournament is full', code: 'TOURNAMENT_FULL' });
});
test('every write that approves an entry answers it', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  expect(read('controllers/tournaments.controller.ts').match(/isEntryCapError\(error\)/g)?.length).toBe(3); // register, direct add, approve
  expect(read('controllers/pairEntries.controller.ts')).toContain("if (isEntryCapError(error)) return { error: 'This event is full.' };");
  expect(read('utils/waitlist.ts')).toContain('if (isEntryCapError(upErr)) { free = 0; break; }');
  expect(read('utils/drawLinks.ts')).toContain('return !error; // F120');
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/157_tournament_entry_cap.sql'), 'utf8');
  expect(sql).toContain("SELECT t.max_teams, t.settings INTO cap, st FROM tournaments t WHERE t.id = NEW.tournament_id FOR UPDATE;");
  expect(sql).toContain("IF NEW.entry_tag = 'Q' THEN RETURN NEW; END IF;");
});
