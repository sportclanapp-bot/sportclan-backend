/**
 * N-R7-205 (Step 2 Batch 9, SPP1-CRM-125) · the chief referee gave a walkover in a carrom
 * tournament ('P06 won by walkover (2–0)'): both players were told, the organiser was not
 * (no notification of any kind). A walkover, default or retirement recorded in a tournament
 * also tells its organisers (creator + co-organisers) — not the person who recorded it.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
const start = src.indexOf('export async function completeMatch');
const body = src.slice(start, src.indexOf('\nexport ', start + 10));

test("a tournament's organisers join the result audience for a walkover, default or retirement", () => {
  const at = body.indexOf("type: 'match_result'");
  const before = body.slice(body.lastIndexOf('matchFollowerIds(id)', at), at);
  expect(before).toMatch(/match\.tournament_id && \(walkover \|\| defaulted \|\| retired\)\s*\?\s*await tournamentOrganiserIds\(match\.tournament_id as string\)/);
  expect(before).toContain('new Set([...players, ...followers, ...organisers])');
});
test('the person who recorded it is still left out (actorId)', () => {
  const at = body.indexOf("type: 'match_result'");
  expect(body.slice(at, at + 400)).toContain('{ actorId: userId }');
});
