/**
 * N-R7-143 (OBS-C2-1): a chess walkover in a tournament with no settings.walkoverScore
 * (made through the API, or an older one) falls back to chess's default, a straight win:
 * 1–0 (a team-chess tie: the boards it needs). It went down with no score ('– – –').
 */
import { walkoverScoreFor, withWalkoverScore } from '../utils/walkoverScore';
import { standardRules } from '../utils/matchRules';

describe('N-R7-143 · chess walkover with no setting', () => {
  test('no settings / no walkoverScore → 1–0', () => {
    expect(walkoverScoreFor('chess', standardRules('chess'), undefined)).toBe(1);
    expect(walkoverScoreFor('chess', standardRules('chess'), { v: 1 })).toBe(1);
    const ss = withWalkoverScore('chess', standardRules('chess'), {}, 'B', { v: 1 });
    expect(ss.walkover_score).toEqual({ B: 1, A: 0 });
  });
  test('a set value still wins; other sports unchanged', () => {
    expect(walkoverScoreFor('chess', standardRules('chess'), { walkoverScore: 'straight' })).toBe(1);
    expect(walkoverScoreFor('tabletennis', standardRules('tabletennis'), { v: 1 })).toBeNull();
    expect(walkoverScoreFor('basketball', standardRules('basketball'), undefined)).toBeNull();
  });
});
