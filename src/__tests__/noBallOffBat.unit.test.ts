/**
 * Decision 2026-09-26 (MATCH_CREATE_TEST_5): runs on a no-ball are off the bat.
 * K1 stored "Nb + 2" as 3 extras nobody scored — the striker got 0 and no ball
 * faced. Now: 1 no-ball extra, 2 to the striker, a ball faced; the bowler is
 * charged 3 and the over does not advance. Mirrors the app's utils/cricketCredit.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
import { aggregateCricketPlayers } from '../controllers/scoring.controller';

const ev = (event_type: string, payload: Record<string, unknown>) => ({ event_type, payload: { team_side: 'B', batsman_id: 'd', batsman_name: 'D', bowler_id: 'c', bowler_name: 'C', ...payload } });

test('K1 over 1, D\'s share: 4, Nb+2, 2, B1 → 8 (4)', () => {
  const p = aggregateCricketPlayers([
    ev('ball', { runs: 4 }),
    ev('extra', { type: 'Nb', runs: 3, is_extra: true }),
    ev('ball', { runs: 2 }),
    ev('extra', { type: 'B', runs: 1, is_extra: true }),
  ]);
  expect(p.d).toMatchObject({ runs: 8, balls: 4, fours: 1 });
  expect(p.c).toMatchObject({ bowl_balls: 3, bowl_runs: 9 });
});

test('a six off a no-ball is the batter\'s six', () => {
  const p = aggregateCricketPlayers([ev('extra', { type: 'Nb', runs: 7, is_extra: true })]);
  expect(p.d).toMatchObject({ runs: 6, balls: 1, sixes: 1 });
  expect(p.c).toMatchObject({ bowl_balls: 0, bowl_runs: 7 });
});

test('a plain no-ball: a ball faced, no runs; a wide is neither', () => {
  const p = aggregateCricketPlayers([ev('extra', { type: 'Nb', runs: 1, is_extra: true }), ev('extra', { type: 'Wd', runs: 2, is_extra: true })]);
  expect(p.d).toMatchObject({ runs: 0, balls: 1 });
  expect(p.c).toMatchObject({ bowl_balls: 0, bowl_runs: 3 });
});
