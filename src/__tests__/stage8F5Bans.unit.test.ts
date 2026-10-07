/**
 * Stage 8 · F5 · bans from cards across a tournament.
 */
import { disciplineRecords, bannedFrom, openBans, disciplineRules } from '../utils/discipline';

const M = (id: string, a: string, b: string, played = true, knockout = false) => ({ id, team_a_id: a, team_b_id: b, played, knockout });
const card = (match_id: string, side: string, kind: string, player_id: string, extra: object = {}) => ({ match_id, payload: { team_side: side, kind, player_id, player_name: player_id.toUpperCase(), ...extra } });
// Lions (L) play m1..m5 in order.
const matches = [M('m1', 'L', 'T'), M('m2', 'E', 'L'), M('m3', 'L', 'X'), M('m4', 'Y', 'L', false), M('m5', 'L', 'Z', false)];

test('2 yellows in separate matches → banned from the next fixture; one booking per match counts', () => {
  const recs = disciplineRecords({}, matches, [card('m1', 'A', 'yellow', 'p1'), card('m2', 'B', 'yellow', 'p1')]);
  expect(recs[0]).toMatchObject({ user_id: 'p1', yellows: 2, reds: 0, bans: [{ matchId: 'm2', reason: '2 yellow cards', length: 1, covers: ['m3'] }] });
  expect(bannedFrom(recs, 'm3').map((b) => [b.user_id, b.reason])).toEqual([['p1', '2 yellow cards']]);
  expect(bannedFrom(recs, 'm4')).toEqual([]);
});

test('a second yellow is a sending-off: its yellows don’t accumulate; the red’s ban applies', () => {
  const recs = disciplineRecords({}, matches, [card('m1', 'A', 'yellow', 'p2'), card('m1', 'A', 'yellow', 'p2'), card('m1', 'A', 'red', 'p2', { second_yellow: true }), card('m3', 'A', 'yellow', 'p2')]);
  expect(recs[0]).toMatchObject({ yellows: 3, reds: 1 });
  expect(recs[0]!.bans.map((b) => [b.reason, b.covers])).toEqual([['sent off (second yellow)', ['m2']]]); // m3's yellow is only the first towards a ban
});

test('a straight red: the organiser’s length; open bans; reset after the groups; off', () => {
  const recs = disciplineRecords({ redBanMatches: 2 }, matches, [card('m3', 'A', 'red', 'p3')]);
  expect(recs[0]!.bans[0]).toMatchObject({ reason: 'red card', covers: ['m4', 'm5'] });
  expect(openBans(recs, new Set(['m1', 'm2', 'm3'])).map((b) => b.remaining)).toEqual([['m4', 'm5']]);
  // wiped at the knockout: a group yellow and a knockout yellow don't make 2
  const ko = [M('g1', 'L', 'T'), M('k1', 'L', 'E', true, true), M('k2', 'L', 'X', false, true)];
  expect(disciplineRecords({ resetAfterGroups: true }, ko, [card('g1', 'A', 'yellow', 'p4'), card('k1', 'A', 'yellow', 'p4')])[0]!.bans).toEqual([]);
  expect(disciplineRecords({}, ko, [card('g1', 'A', 'yellow', 'p4'), card('k1', 'A', 'yellow', 'p4')])[0]!.bans[0]!.covers).toEqual(['k2']);
  // yellows off (only reds ban)
  expect(disciplineRecords({ yellowsForBan: null }, matches, [card('m1', 'A', 'yellow', 'p5'), card('m2', 'B', 'yellow', 'p5')])[0]!.bans).toEqual([]);
  expect(disciplineRules(undefined)).toEqual({ yellowsForBan: 2, banMatches: 1, redBanMatches: 1, resetAfterGroups: false });
});

test('a card with no player named bans nobody; a named guest is one player within their team', () => {
  expect(disciplineRecords({}, matches, [{ match_id: 'm1', payload: { team_side: 'A', kind: 'red' } }])).toEqual([]);
  const g = disciplineRecords({}, matches, [{ match_id: 'm1', payload: { team_side: 'A', kind: 'yellow', player_id: 'guest:x', player_name: 'Raju' } }, { match_id: 'm2', payload: { team_side: 'B', kind: 'yellow', player_id: 'guest:y', player_name: 'raju' } }]);
  expect(g.map((r) => [r.user_id, r.name, r.bans.length])).toEqual([[null, 'Raju', 1]]);
});
