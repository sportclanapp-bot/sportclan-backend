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

  test('level scores are a tie, even with an explicit winner supplied', () => {
    // THE 0-0 BUG: a supplied winner_team_id used to set the winner before the
    // tie was considered, so the tie branch never ran and the margin came out
    // as zero — "WINNER T70450 · won by 0 runs" on 0/0 vs 0/0.
    expect(decideWinnerSide({ aScore: 0, bScore: 0 })).toBeNull();
    expect(decideWinnerSide({ aScore: 0, bScore: 0, explicitWinner: 'A' })).toBeNull();
    expect(decideWinnerSide({ aScore: 7, bScore: 7, explicitWinner: 'B' })).toBeNull();
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

  test('and an explicit winner cannot un-tie it', () => {
    const r = deriveResultText({
      ...base, aScore: 0, bScore: 0, explicitWinner: 'A',
    });
    expect(r.text).toBe('Tied');
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
