/**
 * SC-441 (M1) · one result sentence, and it has to be the RIGHT one.
 *
 * Three surfaces described the same match three ways: "won by 10 wickets"
 * (result screen, correct), "won by 2 runs" (match detail, the raw score
 * difference) and "1 DREW" (team insights). The server's derivation had no
 * wickets branch at all.
 */
import {
  deriveResultText,
  decideWinnerSide,
  chasingSide,
  isSetSport,
} from '../utils/matchResult';

describe('SC-441 · decideWinnerSide', () => {
  test('higher score wins', () => {
    expect(decideWinnerSide({ aScore: 6, bScore: 4 })).toBe('A');
    expect(decideWinnerSide({ aScore: 4, bScore: 6 })).toBe('B');
  });

  test('level scores with no named winner are a tie', () => {
    expect(decideWinnerSide({ aScore: 0, bScore: 0 })).toBeNull();
    expect(decideWinnerSide({ aScore: 7, bScore: 7 })).toBeNull();
  });

  test('F-03: a named winner stands even on level or absent scores', () => {
    // It used to be dropped, so Elo/W-L counted a win the result called "Tied".
    expect(decideWinnerSide({ aScore: 0, bScore: 0, explicitWinner: 'A' })).toBe('A');
    expect(decideWinnerSide({ aScore: 7, bScore: 7, explicitWinner: 'B' })).toBe('B');
  });

  test('an explicit winner overrides the scores when they are not level', () => {
    expect(decideWinnerSide({ aScore: 4, bScore: 6, explicitWinner: 'A' })).toBe('A');
  });
});

describe('SC-441 · chasingSide', () => {
  test('electing to bat means the OTHER side chases', () => {
    expect(chasingSide('A', 'bat')).toBe('B');
    expect(chasingSide('B', 'bat')).toBe('A');
  });
  test('electing to bowl means the toss winner chases', () => {
    expect(chasingSide('A', 'bowl')).toBe('A');
    expect(chasingSide('B', 'bowl')).toBe('B');
  });
  test('unknown toss yields no chaser rather than a guess', () => {
    expect(chasingSide(null, 'bat')).toBeNull();
    expect(chasingSide('A', null)).toBeNull();
    expect(chasingSide('A', 'something')).toBeNull();
  });
});

describe('SC-441 · cricket margins', () => {
  const base = { sport: 'cricket', teamAName: 'Alpha', teamBName: 'Bravo' };

  test('a successful chase wins BY WICKETS, not by runs — the reported bug', () => {
    // Alpha declared on 4; Bravo chased 5 and made 6 without losing a wicket.
    // Observed: Match Detail said "won by 2 runs" (6-4). Correct: 10 wickets.
    const r = deriveResultText({
      ...base, aScore: 4, bScore: 6, aWickets: 0, bWickets: 0,
      tossWinnerSide: 'A', tossChoice: 'bat',
    });
    expect(r.winnerSide).toBe('B');
    expect(r.text).toBe('Bravo won by 10 wickets');
  });

  test('wickets remaining counts what the chaser had left', () => {
    const r = deriveResultText({
      ...base, aScore: 120, bScore: 121, aWickets: 10, bWickets: 7,
      tossWinnerSide: 'A', tossChoice: 'bat',
    });
    expect(r.text).toBe('Bravo won by 3 wickets');
  });

  test('one wicket is singular', () => {
    const r = deriveResultText({
      ...base, aScore: 50, bScore: 51, aWickets: 10, bWickets: 9,
      tossWinnerSide: 'A', tossChoice: 'bat',
    });
    expect(r.text).toBe('Bravo won by 1 wicket');
  });

  test('DEFENDING a total still wins by runs', () => {
    // Alpha batted first and Bravo fell short — runs is the right margin here.
    const r = deriveResultText({
      ...base, aScore: 120, bScore: 95, aWickets: 6, bWickets: 10,
      tossWinnerSide: 'A', tossChoice: 'bat',
    });
    expect(r.text).toBe('Alpha won by 25 runs');
  });

  test('with no toss recorded it falls back to runs rather than guessing', () => {
    const r = deriveResultText({ ...base, aScore: 4, bScore: 6, aWickets: 0, bWickets: 0 });
    expect(r.text).toBe('Bravo won by 2 runs');
  });

  test('a level cricket match is "Tied", never "won by 0 runs"', () => {
    const r = deriveResultText({ ...base, aScore: 0, bScore: 0, aWickets: 0, bWickets: 0 });
    expect(r.winnerSide).toBeNull();
    expect(r.text).toBe('Tied');
    expect(r.text).not.toMatch(/won by 0/);
  });

  test('a named winner on 0/0 is a win with no margin — never "won by 0 runs"', () => {
    const r = deriveResultText({
      ...base, aScore: 0, bScore: 0, explicitWinner: 'A',
    });
    expect(r.winnerSide).toBe('A');
    expect(r.text).toMatch(/ won$/);
    expect(r.text).not.toMatch(/won by 0/);
  });
});

describe('SC-441 · other sports', () => {
  test('chess reports no margin', () => {
    expect(deriveResultText({ sport: 'chess', teamAName: 'A', teamBName: 'B', aScore: 1, bScore: 0 }).text)
      .toBe('A won');
    expect(deriveResultText({ sport: 'chess', teamAName: 'A', teamBName: 'B', aScore: 1, bScore: 1 }).text)
      .toBe('Draw');
  });

  test('set sports report the set score', () => {
    expect(deriveResultText({ sport: 'badminton', teamAName: 'A', teamBName: 'B', aScore: 2, bScore: 1 }).text)
      .toBe('A won 2-1');
  });

  test('the set-sport list lives here now, not in the controller', () => {
    for (const s of ['badminton', 'tennis', 'tabletennis', 'pickleball', 'volleyball']) {
      expect(isSetSport(s)).toBe(true);
    }
    expect(isSetSport('cricket')).toBe(false);
  });

  test('every sport says "Tied" the same way', () => {
    for (const sport of ['cricket', 'badminton', 'football']) {
      expect(deriveResultText({ sport, teamAName: 'A', teamBName: 'B', aScore: 3, bScore: 3 }).text)
        .toBe('Tied');
    }
  });
});

/**
 * SC-442 · the toss must survive a recompute, or the wickets branch is dead.
 *
 * Found on device: a successful chase still reported "won by N runs". The
 * derivation above was correct; its INPUT was missing. matches.controller writes
 * score_summary.toss_winner_side when the toss is recorded — the only place the
 * batting order survives for free-text teams — and its comment claimed
 * "recomputeSummary preserves this key". It did not: that function rebuilds the
 * summary from events, the toss is not an event, so the key was dropped, and
 * chasingSide then had nothing to go on.
 */
describe('SC-442 · toss survives recompute', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'scoring.controller.ts'), 'utf8',
  );

  test('recomputeSummary carries toss_winner_side over from the stored summary', () => {
    expect(src).toContain('toss_winner_side');
    expect(src).toMatch(/if \(existing\[k\] != null && summary\[k\] == null\) summary\[k\] = existing\[k\]/);
  });

  test('it only fills a GAP, so a recomputed value always wins', () => {
    // Guarding on `summary[k] == null` means this can never overwrite something
    // the recompute legitimately produced.
    expect(src).toContain('summary[k] == null');
  });

  test('without the toss the derivation correctly falls back to runs', () => {
    // The behaviour that made the bug look like M1's fault, pinned so the
    // fallback stays sane if the toss is genuinely unknown (skipped toss).
    const r = deriveResultText({
      sport: 'cricket', teamAName: 'A', teamBName: 'B',
      aScore: 6, bScore: 0, aWickets: 0, bWickets: 0,
    });
    expect(r.text).toBe('A won by 6 runs');
  });
});

/**
 * SC-442 · the derivation's INPUTS must actually be loaded.
 *
 * The wickets branch was correct from the start and still reported "won by N
 * runs" on device, three times, because its inputs kept going missing in
 * different ways:
 *
 *   1. toss_winner_side was dropped by recomputeSummary  (fixed)
 *   2. result/winner_side/walkover were dropped the same way  (fixed)
 *   3. toss_choice was never SELECTED in completeMatch  (this one)
 *
 * The third hid behind a type assertion — `(match as { toss_choice?: ... })` —
 * which told the compiler the field was there instead of asking. These tests
 * assert the wiring, because every unit test of the pure function passed
 * throughout while the feature was broken in production.
 */
describe('SC-442 · completeMatch loads what the derivation needs', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8',
  );
  const body = (() => {
    const start = src.indexOf('export async function completeMatch');
    const next = src.indexOf('\nexport ', start + 10);
    // Comments stripped: the removal of the cast is DOCUMENTED in one, and a
    // guard its own explanation can fail is a guard people delete.
    return src.slice(start, next === -1 ? undefined : next)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  })();

  test('toss_choice is selected', () => {
    const select = body.slice(body.indexOf(".select('id, sport_id"));
    expect(select.slice(0, 400)).toContain('toss_choice');
  });

  test('score_summary is selected, for toss_winner_side', () => {
    const select = body.slice(body.indexOf(".select('id, sport_id"));
    expect(select.slice(0, 400)).toContain('score_summary');
  });

  test('toss_choice is read directly, not through a cast that hides its absence', () => {
    expect(body).toContain('tossChoice: match.toss_choice');
    expect(body).not.toMatch(/match as \{ toss_choice/);
  });

  test('both toss inputs reach deriveResultText', () => {
    const call = body.slice(body.indexOf('deriveResultText({'));
    const args = call.slice(0, call.indexOf('});'));
    expect(args).toContain('tossWinnerSide');
    expect(args).toContain('tossChoice');
    expect(args).toContain('aWickets');
    expect(args).toContain('bWickets');
  });
});
