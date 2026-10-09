/**
 * Stage 11 · PB7 · pickleball's USA Pickleball tie-break order as a preset, and
 * best next-placed teams from groups of different sizes compared on the same
 * matches (results against the teams below the smallest group's size don't
 * count) — every sport.
 */
import { bestPlacedAcrossGroups, computeStats, pointsFor, type GMatch } from '../utils/standings';
import { tiebreakPresetsFor, tiebreakRefusal } from '../utils/tournamentSettings';

const m = (a: string, b: string, sa: number, sb: number): GMatch => ({
  team_a_id: a, team_b_id: b, winner_team_id: sa > sb ? a : b, status: 'completed',
  score_summary: { A: { score: sa > sb ? 1 : 0, sets: [sa] }, B: { score: sb > sa ? 1 : 0, sets: [sb] } },
});

// Group X (4): x3 beats the bottom team 11-0 and x2 11-9, loses to x1 0-11.
// Group Y (3): y3 beats y2 11-9, loses to y1 9-11.
const matches: GMatch[] = [
  m('x1', 'x2', 11, 5), m('x1', 'x3', 11, 0), m('x1', 'x4', 11, 2), m('x2', 'x4', 11, 3), m('x3', 'x2', 11, 9), m('x3', 'x4', 11, 0),
  m('y1', 'y2', 11, 4), m('y1', 'y3', 11, 9), m('y3', 'y2', 11, 9),
];
const groups = [['x1', 'x2', 'x3', 'x4'], ['y1', 'y3', 'y2']];
const pts = pointsFor('pickleball');
const stats = computeStats(groups.flat(), matches, undefined, pts);

describe('PB7 · groups of different sizes', () => {
  it('per game played (before): x3 looks better — its 11-0 over the bottom team counts', () => {
    expect(bestPlacedAcrossGroups([['x1', 'x3', 'x2', 'x4'], ['y1', 'y3', 'y2']], 1, 1, stats, ['points_diff'])).toEqual(['x3']);
  });

  it('with the matches: x3’s results against x4 (4th, below a group of 3) are left out → y3 goes through', () => {
    // x3 v x1, x2: won 1, lost 1, points 11-22 (−11); y3 v y1, y2: won 1, lost 1, points 20-20 (0).
    expect(bestPlacedAcrossGroups([['x1', 'x3', 'x2', 'x4'], ['y1', 'y3', 'y2']], 1, 1, stats, ['points_diff'], { matches, pts })).toEqual(['y3']);
  });

  it('groups of the same size are compared as before', () => {
    const even = [['x1', 'x3', 'x2'], ['y1', 'y3', 'y2']];
    const same = matches.filter((x) => x.team_a_id !== 'x4' && x.team_b_id !== 'x4');
    const st = computeStats(even.flat(), same, undefined, pts);
    expect(bestPlacedAcrossGroups(even, 1, 1, st, ['points_diff'], { matches: same, pts })).toEqual(bestPlacedAcrossGroups(even, 1, 1, st, ['points_diff']));
  });

  it('a place only bigger groups have (4th) compares those groups as they are', () => {
    const g = [['x1', 'x2', 'x3', 'x4'], ['y1', 'y3', 'y2']];
    expect(bestPlacedAcrossGroups(g, 3, 1, stats, ['points_diff'], { matches, pts })).toEqual(['x4']);
  });
});

describe('PB7 · the USA Pickleball preset', () => {
  it('is offered for pickleball, in the 15.B.4 order, and stores', () => {
    const usap = tiebreakPresetsFor('pickleball').find((p) => p.key === 'usap')!;
    expect(usap.label).toBe('USA Pickleball (head-to-head, points)');
    expect(usap.order).toEqual(['head_to_head', 'points_diff', 'h2h_points_diff', 'points_won']);
    expect(tiebreakRefusal('pickleball', usap.order)).toBeNull();
  });
  it('isn’t offered for other sports', () => {
    for (const s of ['badminton', 'tabletennis', 'tennis', 'football', 'cricket']) expect(tiebreakPresetsFor(s).some((p) => p.key === 'usap')).toBe(false);
  });
});
