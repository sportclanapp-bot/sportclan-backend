/**
 * Retired hurt is not a wicket (2026-09-26, after MATCH_CREATE_TEST_5 — K4 had
 * "Chg Seven retired hurt" count as the 7th wicket). Retired out is a wicket.
 * Neither goes to the bowler. A retired-hurt batter who bats again is back in.
 */
import fs from 'fs';
import path from 'path';
jest.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
import { aggregateCricketPlayers } from '../controllers/scoring.controller';
import { wicketWords } from '../controllers/matches.controller';

const ev = (event_type: string, p: Record<string, unknown>) => ({ event_type, payload: { team_side: 'B', bowler_id: 'bw', bowler_name: 'Bowl', ...p } });
const bat = (id: string) => ({ batsman_id: id, batsman_name: id.toUpperCase() });

test('retired hurt: not out, "retired_hurt" on the card, no ball, no bowler wicket', () => {
  const p = aggregateCricketPlayers([ev('ball', { runs: 3, ...bat('x') }), ev('wicket', { wicket_type: 'retired_hurt', is_extra: true, ...bat('x') })]);
  expect(p.x).toMatchObject({ out: false, dismissal: 'retired_hurt', runs: 3, balls: 1 });
  expect(p.bw).toMatchObject({ bowl_wickets: 0, bowl_balls: 1 });
});

test('a retired batter who bats again is back in — and can then be out', () => {
  const back = aggregateCricketPlayers([
    ev('wicket', { wicket_type: 'retired_hurt', is_extra: true, ...bat('x') }),
    ev('ball', { runs: 4, ...bat('x') }),
  ]);
  expect(back.x?.dismissal).toBeUndefined();
  expect(back.x?.out).toBe(false);
  const outLater = aggregateCricketPlayers([
    ev('wicket', { wicket_type: 'retired_hurt', is_extra: true, ...bat('x') }),
    ev('wicket', { wicket_type: 'bowled', ...bat('x') }),
  ]);
  expect(outLater.x).toMatchObject({ out: true, dismissal: 'bowled' });
});

test('retired out IS out, and nobody\'s wicket', () => {
  const p = aggregateCricketPlayers([ev('wicket', { wicket_type: 'retired_out', is_extra: true, ...bat('y') })]);
  expect(p.y).toMatchObject({ out: true, dismissal: 'retired_out' });
  expect(p.y?.dismissal_bowler).toBeUndefined();
  expect(p.bw?.bowl_wickets).toBe(0);
});

describe('source', () => {
  const sc = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  const mc = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  test('the innings counts only dismissals (all out, "won by N wickets")', () => {
    expect(sc).toContain("else if (e.event_type === 'wicket') { if (isDismissal(p.wicket_type ?? p.type)) inn.wickets = Math.min(allOut[sideOf(p)], inn.wickets + 1);");
  });
  test('the push and the timeline say "retired hurt"', () => {
    expect(sc).toContain("const title = hurt ? 'Retired hurt' : 'Wicket!';");
    expect(mc).toContain('commentary = `\\uD83E\\uDE79 Retired hurt — ${batter}`;');
    expect(mc).toContain('const batter = p.batsman_name || p.batsmanName ||');
  });
});

test('the timeline names the manner of a wicket', () => {
  expect(wicketWords('caught', 'Sharma', 'Khan')).toBe('c Sharma b Khan');
  expect(wicketWords('run_out', 'Patel')).toBe('run out (Patel)');
  expect(wicketWords('retired_out')).toBe('retired out');
  expect(wicketWords('')).toBe('');
});
