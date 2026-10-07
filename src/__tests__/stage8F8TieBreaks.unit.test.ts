/**
 * Stage 8 · F8 + best runners-up · fair play as a tie-break, the organiser's
 * draw of lots as the last one (and the table says who's level until then),
 * and the best next-placed teams across groups by the same order, as many as
 * the organiser chose.
 */
import { rankTeams, rankTeamsDetailed, bestPlacedAcrossGroups, bestNextCount, groupsKnockoutSize, computeStats } from '../utils/standings';
import { tiebreaksFor, tiebreakToken, tiebreakLabel, tiebreakPresetsFor, settingsRefusal } from '../utils/tournamentSettings';

const m = (a: string, b: string, ga: number, gb: number) => ({ team_a_id: a, team_b_id: b, winner_team_id: ga > gb ? a : gb > ga ? b : null, status: 'completed', score_summary: { A: { value: ga }, B: { value: gb } } });
// A, B, C all 1–1 with each other: level on everything.
const level3 = [m('A', 'B', 1, 1), m('B', 'C', 1, 1), m('C', 'A', 1, 1)];

test('fair play separates teams level on goals; football and hockey only; FIFA preset', () => {
  const fp = new Map([['A', -3], ['B', 0], ['C', -1]]);
  expect(rankTeams(['A', 'B', 'C'], level3, ['head_to_head', 'score_diff', 'score_scored', 'fair_play'], undefined, { fairPlay: fp })).toEqual(['B', 'C', 'A']);
  expect(tiebreaksFor('football')).toContain('fair_play');
  expect(tiebreaksFor('hockey')).toContain('fair_play');
  expect(tiebreaksFor('badminton')).not.toContain('fair_play');
  expect([tiebreakToken('fairplay'), tiebreakLabel('football', 'fair_play')]).toEqual(['fair_play', 'Fair play (cards)']);
  expect(tiebreakPresetsFor('football').find((p) => p.key === 'fifa')!.order).toEqual(['head_to_head', 'score_diff', 'score_scored', 'fair_play']);
});

test('level on everything: reported, placed by id — until a draw of lots orders them (all sports)', () => {
  const d = rankTeamsDetailed(['C', 'A', 'B'], level3, ['head_to_head', 'score_diff']);
  expect(d.level).toEqual([['A', 'B', 'C']]);
  expect(d.order).toEqual(['A', 'B', 'C']);
  const lot = rankTeamsDetailed(['C', 'A', 'B'], level3, ['head_to_head'], undefined, { lots: ['C', 'A', 'B'] });
  expect([lot.order, lot.level]).toEqual([['C', 'A', 'B'], []]);
  // a lot that misses one of them still reports the tie
  expect(rankTeamsDetailed(['C', 'A', 'B'], level3, [], undefined, { lots: ['C', 'A'] }).level).toEqual([['C', 'A', 'B']]);
  // separated teams aren't level
  expect(rankTeamsDetailed(['A', 'B'], [m('A', 'B', 2, 0)], []).level).toEqual([]);
});

test('best next-placed across groups: the same order per game played, then fair play, then lots; as many as the organiser chose', () => {
  // two groups' second places: X (4 pts, +1 in 2) and Y (4 pts, +1 in 2) level; fair play decides
  const ms = [m('X', 'p', 2, 1), m('X', 'q', 0, 0), m('X', 'r', 1, 1), m('Y', 's', 1, 0), m('Y', 't', 0, 0), m('Y', 'u', 2, 2), m('Z', 'v', 0, 3)];
  const stats = computeStats(['X', 'Y', 'Z', 'p', 'q', 'r', 's', 't', 'u', 'v'], ms);
  const groups = [['w1', 'X'], ['w2', 'Y'], ['w3', 'Z']];
  expect(bestPlacedAcrossGroups(groups, 1, 1, stats, ['head_to_head', 'score_diff', 'score_scored', 'fair_play'], { fairPlay: new Map([['X', -2], ['Y', 0]]) })).toEqual(['Y']);
  expect(bestPlacedAcrossGroups(groups, 1, 1, stats, ['score_diff'], { lots: ['Y', 'X'] })).toEqual(['Y']); // points and difference level → the draw of lots
  expect(bestPlacedAcrossGroups(groups, 1, 2, stats)).toEqual(['X', 'Y']); // old default
});

test('how many go through, and the knockout’s size', () => {
  expect(bestNextCount({ bestNext: 2 }, [4, 4, 4], 1)).toBe(2);
  expect(bestNextCount({ bestNext: 9 }, [4, 4, 2], 2)).toBe(2); // only groups with a team in that place
  expect(bestNextCount({ bestThirds: true }, [4, 4, 4, 4, 4, 4], 1)).toBe(2); // fill the byes (6 → 8)
  expect(bestNextCount({}, [4, 4], 2)).toBe(0);
  expect(groupsKnockoutSize(6, 1, 2)).toBe(8); // Durand: 6 winners + 2 best runners-up
  expect(groupsKnockoutSize(6, 1, 3)).toBe(16);
  expect(groupsKnockoutSize(4, 2, null)).toBe(8);
});

test('settings: bestNext for groups only; lots each team once; discipline numbers', () => {
  expect(settingsRefusal('football', 'groups_knockout', { bestNext: 2 })).toBeNull();
  expect(settingsRefusal('football', 'league', { bestNext: 2 })?.error).toMatch(/groups → knockout/);
  expect(settingsRefusal('football', 'league', { lots: { '': ['a', 'a'] } })?.error).toMatch(/each team once/);
  expect(settingsRefusal('football', 'league', { discipline: { yellowsForBan: 2, banMatches: 1, redBanMatches: 1 } })).toBeNull();
  expect(settingsRefusal('football', 'league', { discipline: { yellowsForBan: 0 } })?.error).toMatch(/1 or more/);
});
