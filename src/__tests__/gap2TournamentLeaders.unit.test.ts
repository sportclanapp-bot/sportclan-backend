/**
 * Cricket gap 2 (5 Oct 2026) · a cricket tournament's leaderboards, and the
 * /top-performers endpoint fixed: it sent { topWins } while the app's type
 * read { performers }. topWins stays for older apps.
 */
import { tournamentLeaders, leaderUserIds, type LeaderMatch, type StatsRow } from '../utils/tournamentLeaders';

const TEAMS = { tA: 'Sunrisers', tB: 'Royals', tC: 'Strikers' };
const m = (id: string, a: string, b: string, players: LeaderMatch['players']): LeaderMatch => ({ id, team_a_id: a, team_b_id: b, players });

const M1 = m('m1', 'tA', 'tB', {
  u1: { name: 'Ravi', side: 'A', runs: 45, balls: 30, sixes: 3, out: true, bowl_balls: 12, bowl_runs: 20, bowl_wickets: 1 },
  u2: { name: 'Kiran', side: 'B', runs: 10, balls: 12, bowl_balls: 12, bowl_runs: 12, bowl_wickets: 3, catches: 2 },
  'guest:abc': { name: 'Raju', side: 'A', runs: 20, balls: 10, sixes: 2, catches: 1 },
});
const M2 = m('m2', 'tA', 'tC', {
  u1: { name: 'Ravi', side: 'A', runs: 30, balls: 25, sixes: 1, bowl_balls: 6, bowl_runs: 4, bowl_wickets: 2 },
  'guest:xyz': { name: 'raju ', side: 'A', runs: 25, balls: 12, sixes: 2 }, // same guest, new id
  'guest:zzz': { name: 'Raju', side: 'B', runs: 5, balls: 4 }, // another team's Raju
  u3: { name: 'Sameer', side: 'B', runs: 0, bowl_balls: 12, bowl_runs: 30, bowl_wickets: 3, stumpings: 1 },
});
// An older match with no rollup: its innings_stats rows.
const ROWS: StatsRow[] = [
  { match_id: 'm3', user_id: 'u2', team_id: 'tB', name: 'Kiran', runs: 60, balls_faced: 40, sixes: 4, is_out: false, bowling_overs: 1.3, bowling_runs: 15, bowling_wickets: 1, catches: 0, runouts: 1, stumpings: 0 },
  { match_id: 'm1', user_id: 'u1', team_id: 'tA', name: 'Ravi', runs: 999, balls_faced: 1, sixes: 99, is_out: false, bowling_overs: 0, bowling_runs: 0, bowling_wickets: 0, catches: 0, runouts: 0, stumpings: 0 },
];
const L = tournamentLeaders([M1, M2, m('m3', 'tB', 'tC', null)], ROWS, TEAMS);

test('most runs: summed across matches, older matches from innings_stats, a match never counted twice', () => {
  expect(L.runs.map((r) => [r.name, r.value, r.team_name])).toEqual([['Ravi', 75, 'Sunrisers'], ['Kiran', 70, 'Royals'], ['Raju', 45, 'Sunrisers'], ['Raju', 5, 'Strikers']]);
  expect(L.runs[0]).toMatchObject({ user_id: 'u1', stat: 'runs', detail: '2 matches · SR 136' });
  expect(L.runs[2]!.user_id).toBeNull(); // a guest
});
test('most wickets, ties on fewer runs; best bowling in a match is wickets then runs', () => {
  expect(L.wickets.map((r) => [r.name, r.value])).toEqual([['Kiran', 4], ['Ravi', 3], ['Sameer', 3]]);
  expect(L.wickets[0]!.detail).toBe('2 matches · 3.3 ov · 27 runs');
  expect(L.best_bowling.map((r) => [r.name, r.detail])).toEqual([['Kiran', '3/12'], ['Sameer', '3/30'], ['Ravi', '2/4']]);
});
test('sixes and catches; a guest is one player by name within their team', () => {
  expect(L.sixes.map((r) => [r.name, r.value])).toEqual([['Kiran', 4], ['Raju', 4], ['Ravi', 4]]);
  expect(L.catches.map((r) => [r.name, r.value])).toEqual([['Kiran', 2], ['Raju', 1]]);
});
test('player of the tournament: runs + 25 a wicket + 10 a catch, run-out or stumping', () => {
  // Kiran 70 + 4×25 + (2 catches + 1 run-out)×10 = 200; Ravi 75 + 75 = 150; Sameer 0 + 75 + 10 = 85.
  expect(L.player_of_tournament.slice(0, 3).map((r) => [r.name, r.value])).toEqual([['Kiran', 200], ['Ravi', 150], ['Sameer', 85]]);
  expect(L.player_of_tournament[0]!.detail).toBe('70 runs · 4 wkts · 3 in the field');
});
test('at most five a board; empty boards for a tournament with nothing scored ball by ball', () => {
  const many = m('m9', 'tA', 'tB', Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`u${i + 10}`, { name: `P${i}`, side: 'A' as const, runs: 10 + i }])));
  expect(tournamentLeaders([many], [], TEAMS).runs).toHaveLength(5);
  const none = tournamentLeaders([m('m0', 'tA', 'tB', null)], [], TEAMS);
  expect(Object.values(none).every((b) => b.length === 0)).toBe(true);
});
test('deleted accounts are left off; leaderUserIds lists the accounts named', () => {
  const skip = tournamentLeaders([M1, M2], ROWS, TEAMS, { u2: { name: 'Kiran', deleted: true } });
  expect(skip.runs.map((r) => r.name)).not.toContain('Kiran');
  expect(leaderUserIds([M1, M2], ROWS).sort()).toEqual(['u1', 'u2', 'u3']);
});

test('an account’s name today, even when the rollup has none (found on the local server: ids only)', () => {
  const nameless = m('m5', 'tA', 'tB', { u1: { side: 'A', runs: 12 }, u9: { side: 'B', runs: 30 }, 'guest:q': { side: 'A', runs: 50 } });
  const L2 = tournamentLeaders([nameless], [], TEAMS, { u1: { name: 'Ravi K', deleted: false } });
  // u1 named from the account; u9 (no account row, no name) and the unnamed guest can't be shown.
  expect(L2.runs.map((r) => [r.name, r.value])).toEqual([['Ravi K', 12]]);
  expect(tournamentLeaders([M1], [], TEAMS, { u1: { name: 'Ravi Kumar', deleted: false } }).runs[0]!.name).toBe('Ravi Kumar');
});
// Oct 2026 (pre-release pass, found on the device: "1 runs · 1 wkt").
test('one run reads "1 run"', () => {
  const one = tournamentLeaders([m('m9', 'tA', 'tB', { u9: { name: 'Solo', side: 'A', runs: 1, balls: 1, sixes: 0, bowl_balls: 6, bowl_runs: 1, bowl_wickets: 1 } })], [], TEAMS);
  expect(one.player_of_tournament[0]!.detail).toBe('1 run · 1 wkt');
  expect(one.wickets[0]!.detail).toBe('1 match · 1 ov · 1 run');
});
