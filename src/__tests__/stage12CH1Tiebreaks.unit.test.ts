/**
 * Stage 12 · CH1 · FIDE C.07 (2026) tie-breaks for chess, hand-worked.
 * Side A has White, side B Black.
 */
import { rankTeamsDetailed, rankTeams, pointsFor, type GMatch } from '../utils/standings';
import { tiebreakPresetsFor, tiebreakLabel, tiebreakRefusal, tiebreaksFor } from '../utils/tournamentSettings';

const pts = pointsFor('chess');
const g = (round: number, w: string, b: string, res: 'w' | 'b' | 'd', extra: Partial<GMatch> = {}): GMatch => ({
  round, team_a_id: w, team_b_id: b, winner_team_id: res === 'w' ? w : res === 'b' ? b : null, status: 'completed', score_summary: {}, ...extra,
});
const bye = (round: number, p: string, kind?: 'half' | 'zero' | 'full'): GMatch => ({ round, team_a_id: p, team_b_id: null, winner_team_id: kind === 'zero' || kind === 'half' ? null : p, status: 'completed', score_summary: { bye: true, ...(kind ? { bye_kind: kind } : {}) } });

describe('CH1 · Sonneborn-Berger and Koya (round robin)', () => {
  // Four players, round robin; A and B level on points, SB and Koya differ.
  const rr = [g(1, 'A', 'B', 'd'), g(1, 'C', 'D', 'w'), g(2, 'A', 'C', 'w'), g(2, 'B', 'D', 'w'), g(3, 'D', 'A', 'd'), g(3, 'C', 'B', 'd')];
  // Points: A ½+1+½ = 2, B ½+1+½ = 2, C 1+0+½ = 1½, D 0+0+½ = ½.
  it('SB: A = B ½·2 (1) + C 1½ + D ½·½ (¼) = 2¾; B = A ½·2 (1) + D ½ + C ½·1½ (¾) = 2¼ → A first', () => {
    expect(rankTeams(['A', 'B', 'C', 'D'], rr, ['sonneborn_berger'], pts).slice(0, 2)).toEqual(['A', 'B']);
  });
  it('Koya: points against those on 50% or more (A, B on 2/3, C on 1½/3) — A: ½ + 1 = 1½, B: ½ + ½ = 1 → A first', () => {
    expect(rankTeams(['B', 'A', 'C', 'D'], rr, ['koya'], pts).slice(0, 2)).toEqual(['A', 'B']);
  });
});

describe('CH1 · each tie-break separates the right way', () => {
  // Two players level on points, with different histories.
  const L = (r: number, w: string, b: string, res: 'w' | 'b' | 'd') => g(r, w, b, res);
  it('wins with Black and games with Black', () => {
    // A: 2 wins, one with Black; B: 2 wins, both with White → wins with Black: A first.
    const ms = [L(1, 'A', 'X', 'w'), L(2, 'Y', 'A', 'b'), L(3, 'A', 'Z', 'b'), L(1, 'B', 'Y', 'w'), L(2, 'B', 'Z', 'w'), L(3, 'X', 'B', 'w')];
    const all = ['A', 'B', 'X', 'Y', 'Z'];
    expect(rankTeams(all, ms, ['wins_black'], pts).slice(0, 2)).toEqual(['A', 'B']);
    expect(tiebreakLabel('chess', 'wins_black')).toBe('Wins with Black');
  });
  it('progressive score: winning early ranks higher', () => {
    // A wins R1, R2, loses R3 → 1, 2, 2 = 5; B loses R1, wins R2, R3 → 0, 1, 2 = 3.
    const ms = [L(1, 'A', 'X', 'w'), L(2, 'A', 'Y', 'w'), L(3, 'A', 'Z', 'b'), L(1, 'B', 'Z', 'b'), L(2, 'B', 'X', 'w'), L(3, 'B', 'Y', 'w')];
    expect(rankTeams(['A', 'B', 'X', 'Y', 'Z'], ms, ['progressive'], pts).slice(0, 2)).toEqual(['A', 'B']);
  });
});

describe('CH1 · unplayed rounds the FIDE way', () => {
  // R1 X–W 1-0 · R2 X asks for a zero bye, W gets the pairing bye. X 1, W 1.
  const ms = [g(1, 'X', 'W', 'w'), bye(2, 'X', 'zero'), bye(2, 'W')];
  it('own unplayed round = a dummy opponent with the player’s own score; an opponent’s last-round requested bye counts as a draw', () => {
    // BH W = X adjusted (1 + ½ for the trailing zero bye) + own 1 = 2½; BH X = W 1 + own 1 = 2 → W first.
    expect(rankTeams(['X', 'W'], ms, ['buchholz'], pts)).toEqual(['W', 'X']);
  });
  it('Cut-1 drops the voluntary unplayed round first', () => {
    // Cut-1 X = 2 − 1 (the zero bye) = 1; Cut-1 W = 2½ − 1 (no VUR: the lowest, own 1 or X 1½ → 1) = 1½ → W first.
    expect(rankTeams(['X', 'W'], ms, ['buchholz_cut1'], pts)).toEqual(['W', 'X']);
  });
  it('a half bye scores half a point, a zero bye nothing, the pairing’s bye a win', () => {
    const d = rankTeamsDetailed(['A', 'B', 'C'], [bye(1, 'A', 'half'), bye(1, 'B', 'zero'), bye(1, 'C')], [], pts);
    expect(d.order).toEqual(['C', 'A', 'B']);
  });
});

describe('CH1 · the AICF preset, labels, checks', () => {
  it('AICF / Indian open: BH Cut-1, BH, SB, direct encounter, wins, wins with Black', () => {
    const p = tiebreakPresetsFor('chess').find((x) => x.key === 'aicf')!;
    expect(p.order).toEqual(['buchholz_cut1', 'buchholz', 'sonneborn_berger', 'head_to_head', 'wins', 'wins_black']);
    expect(tiebreakRefusal('chess', p.order)).toBeNull();
    expect(tiebreakLabel('chess', 'head_to_head')).toBe('Direct encounter');
    expect(tiebreakLabel('football', 'head_to_head')).toBe('Head-to-head');
    expect(tiebreakRefusal('football', ['buchholz_cut1'])?.error).toMatch(/isn’t a tie-break for this sport/);
    expect(tiebreaksFor('chess')).toEqual(expect.arrayContaining(['buchholz_cut1', 'buchholz_median', 'wins_black', 'games_black', 'progressive', 'aro', 'koya']));
  });
  it('FIDE codes are understood', () => {
    expect(rankTeams(['X', 'W'], [g(1, 'X', 'W', 'w'), bye(2, 'X', 'zero'), bye(2, 'W')], ['BH-C1'], pts)).toEqual(['W', 'X']);
  });
  it('average rating of opponents, from the ratings given', () => {
    // A beat X (1800); B beat Y (1500) → A first.
    const ms = [g(1, 'A', 'X', 'w'), g(1, 'B', 'Y', 'w')];
    expect(rankTeams(['A', 'B', 'X', 'Y'], ms, ['aro'], pts, { ratings: new Map([['X', 1800], ['Y', 1500]]) }).slice(0, 2)).toEqual(['A', 'B']);
  });
});
