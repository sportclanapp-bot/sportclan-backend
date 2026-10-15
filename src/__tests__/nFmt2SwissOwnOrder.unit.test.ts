/**
 * N-FMT-2 (launch test plan, Round 3): a team Swiss created with the order its form shows was saved
 * with chess's Buchholz order — a table ranked on tie-breaks nobody chose, which the server itself
 * refuses for the sport. A non-chess Swiss with no order of its own gets its sport's standard.
 */
import fs from 'fs';
import path from 'path';
import { swissDefaultTiebreaks, tiebreakRefusal } from '../utils/tournamentSettings';

test('chess keeps Buchholz; the rest their standard', () => {
  expect(swissDefaultTiebreaks('chess')).toEqual(['buchholz', 'sonneborn_berger', 'wins']);
  for (const s of ['badminton', 'tennis', 'tabletennis', 'pickleball', 'carrom']) expect(swissDefaultTiebreaks(s)).toEqual(['head_to_head', 'score_diff', 'score_scored']);
  expect(swissDefaultTiebreaks('cricket')).toEqual(['head_to_head', 'nrr', 'score_diff', 'score_scored']);
  // the default is one the server accepts for that sport (Buchholz isn't, outside chess)
  for (const s of ['badminton', 'carrom', 'chess', 'cricket']) expect(tiebreakRefusal(s, swissDefaultTiebreaks(s))).toBeNull();
  expect(tiebreakRefusal('badminton', ['buchholz', 'sonneborn_berger', 'wins'])?.code).toBe('INVALID_TIEBREAKS');
});
test('creation uses it', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
  expect(s).toContain(": !parent && format === 'swiss' ? swissDefaultTiebreaks(createSportSlug) : [],");
});
