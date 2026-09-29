/**
 * BUILD 1.6 · chess standings.
 *
 * Two bugs in the shared standings ladder:
 *   1. every sport scored 3 / 1 / 0, so a chess table was ranked on football
 *      points — two wins beat five draws, where chess has them 2 against 2½;
 *   2. a draw's ½ (stored as 0.5) parsed as 0 in the score tiebreaks.
 */
import {
  parseScoreNum, computeStats, rankTeams, pointsModelFor, CHESS_POINTS, DEFAULT_POINTS, type GMatch,
} from '../utils/standings';

const done = (a: string, b: string, winner: string | null, sa: number, sb: number): GMatch => ({
  team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed',
  score_summary: { A: { score: sa }, B: { score: sb } },
});

describe('BUILD 1.6 · a ½ score parses as ½', () => {
  it.each([
    [0.5, 0.5], ['0.5', 0.5], ['½', 0.5], ['1½', 1.5], [1, 1], ['2.5', 2.5],
    ['89/2', 89], ['6-4', 6], [null, 0], ['', 0], ['-3', -3],
  ])('%p → %p', (input, out) => {
    expect(parseScoreNum(input)).toBe(out);
  });
});

describe('BUILD 1.6 · chess scores 1 / ½ / 0', () => {
  it('pointsModelFor picks chess by slug and leaves every other sport on 3 / 1 / 0', () => {
    expect(pointsModelFor('chess')).toEqual({ win: 1, draw: 0.5, loss: 0 });
    expect(pointsModelFor(' Chess ')).toBe(CHESS_POINTS);
    expect(pointsModelFor('football')).toBe(DEFAULT_POINTS);
    expect(pointsModelFor(undefined)).toBe(DEFAULT_POINTS);
  });

  it('a chess draw is ½ a point each, and its ½ counts in scored', () => {
    const s = computeStats(['W', 'B'], [done('W', 'B', null, 0.5, 0.5)], undefined, CHESS_POINTS);
    expect(s.get('W')).toMatchObject({ points: 0.5, drawn: 1, scored: 0.5, conceded: 0.5 });
    const w = computeStats(['W', 'B'], [done('W', 'B', 'W', 1, 0)], undefined, CHESS_POINTS);
    expect(w.get('W')!.points).toBe(1);
    expect(w.get('B')!.points).toBe(0);
  });

  it('five draws (2½) rank above two wins (2) in chess; football order is unchanged', () => {
    const o = ['O1', 'O2', 'O3', 'O4', 'O5'];
    const ms = [
      done('X', 'O1', 'X', 1, 0), done('X', 'O2', 'X', 1, 0),
      ...o.map((t) => done('Y', t, null, 0.5, 0.5)),
    ];
    const ids = ['X', 'Y', ...o];
    const chess = rankTeams(ids, ms, [], CHESS_POINTS);
    expect(chess.indexOf('Y')).toBeLessThan(chess.indexOf('X'));
    const football = rankTeams(ids, ms, []);
    expect(football.indexOf('X')).toBeLessThan(football.indexOf('Y'));
  });

  it('two draws score 1 in the scored / difference columns (the ½s used to read as 0)', () => {
    const ms = [done('R', 'S', null, 0.5, 0.5), done('R', 'T', null, 0.5, 0.5), done('S', 'T', 'S', 1, 0)];
    const s = computeStats(['R', 'S', 'T'], ms, undefined, CHESS_POINTS);
    expect(s.get('R')).toMatchObject({ points: 1, scored: 1, conceded: 1, diff: 0 });
    expect(s.get('T')).toMatchObject({ points: 0.5, scored: 0.5, conceded: 1.5, diff: -1 });
    // S 1½, R 1, T ½.
    expect(rankTeams(['R', 'S', 'T'], ms, [], CHESS_POINTS)).toEqual(['S', 'R', 'T']);
  });
});
