/**
 * Stage 9 · T3 · one tie engine for every tie sport: the organiser's own list
 * of matches and win rule (first to N; all, most rubbers; all, most games).
 */
import { rollupTieSpec, rollupTie } from '../controllers/scoring.controller';
import { tieSpecProblem, tieOutcome, type TieSpec } from '../utils/tieCore';
import { standardRules, setConfigOf, tieSpecOf, rulesRefusal, type MatchRules } from '../utils/matchRules';
import { tieSpecLineupProblem } from '../controllers/tieLineup.controller';

const pt = (side: 'A' | 'B', n = 1) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side } }));
const side = (p: any) => (p?.team_side === 'B' ? 'B' : 'A') as 'A' | 'B';
/** A tennis pro set to 4 (short), won 4–0 by `w`: 16 points. */
const set4 = (w: 'A' | 'B') => pt(w, 16);
const tennis = (spec: TieSpec): MatchRules => ({ ...standardRules('tennis'), bestOf: 1, gamesPerSet: 4, tie: spec });
const R = (n: number, players: 1 | 2 = 2) => ({ key: `R${n}`, label: `Doubles ${n}`, players });

test('tennis, three doubles, first to 2: decided after two, the third not played', () => {
  const spec: TieSpec = { rubbers: [R(1), R(2), R(3)], win: 'first' };
  const t = rollupTieSpec('tennis', tennis(spec), spec, [...set4('A'), ...set4('A'), ...set4('B')], side);
  expect([t.scoreA, t.scoreB, t.tie.decided, t.results.length]).toEqual([2, 0, 'A', 2]);
  expect(t.results[0]).toMatchObject({ key: 'R1', label: 'Doubles 1', A: 1, B: 0, winner: 'A', unitsA: 4, unitsB: 0 });
});

test('all rubbers, most rubbers; level → most games, then a draw', () => {
  const spec: TieSpec = { rubbers: [R(1), R(2)], win: 'all' };
  const t = rollupTieSpec('tennis', tennis(spec), spec, [...set4('A'), ...pt('B', 12), ...pt('A', 4), ...pt('B', 4)], side);
  // R1 A 4–0; R2 B 4–1 → rubbers 1–1, games A 5, B 4 → A
  expect([t.tie.rubbersA, t.tie.rubbersB, t.tie.unitsA, t.tie.unitsB, t.tie.decided]).toEqual([1, 1, 5, 4, 'A']);
  expect(tieOutcome(spec, [{ key: 'R1', winner: 'A', sets: { A: [4], B: [0] }, units: { A: 4, B: 0 } }, { key: 'R2', winner: 'B', sets: { A: [0], B: [4] }, units: { A: 0, B: 4 } }]).decided).toBe('draw');
});

test('a games tie (TPL): every rubber played, most games wins, the score is games', () => {
  const spec: TieSpec = { rubbers: [R(1, 1), R(2, 1)], win: 'games' };
  const t = rollupTieSpec('tennis', tennis(spec), spec, [...set4('A'), ...pt('A', 4), ...pt('B', 16)], side);
  // R1 A 4–0; R2 B 4–1 → rubbers 1–1, games A 5, B 4: A on games
  expect([t.scoreA, t.scoreB, t.tie.rubbersA, t.tie.rubbersB, t.tie.decided]).toEqual([5, 4, 1, 1, 'A']);
});

test('badminton’s standard order reads exactly as before', () => {
  const rules: MatchRules = { ...standardRules('badminton'), bestOf: 1, target: 21, cap: 30, rubbers: 3 };
  const evs = [...pt('A', 21), ...pt('B', 21), ...pt('B', 21)];
  const old = rollupTie(setConfigOf(rules), 3, evs, side);
  const now = rollupTieSpec('badminton', rules, tieSpecOf('badminton', rules)!, evs, side);
  expect([now.scoreA, now.scoreB, now.setsA, now.setsB, now.rubber]).toEqual([old.rubbersA, old.rubbersB, old.setScoresA, old.setScoresB, old.rubber]);
  expect(now.results.map((r) => ({ A: r.A, B: r.B, winner: r.winner }))).toEqual(old.results);
  expect(now.results.map((r) => r.key)).toEqual(['S1', 'D1', 'S2']);
});

test('the rules: a valid list, refusals; the line-up: singles once, doubles once — unless repeats are allowed', () => {
  expect(tieSpecProblem({ rubbers: [R(1)], win: 'first' })).toBeNull();
  expect(tieSpecProblem({ rubbers: [], win: 'first' })).toMatch(/at least one match/);
  expect(tieSpecProblem({ rubbers: [R(1), R(1)], win: 'first' })).toMatch(/share/);
  expect(tieSpecProblem({ rubbers: [{ ...R(1, 1), pairAgeMin: 90 }], win: 'all' })).toMatch(/for doubles/);
  expect(tieSpecProblem({ rubbers: [R(1), R(2)], win: 'first', firstTo: 3 })).toMatch(/First to 1 to 2/);
  expect(rulesRefusal('tennis', { ...standardRules('tennis'), tie: { rubbers: [R(1)], win: 'first' } })).toBeNull();
  expect(rulesRefusal('badminton', { ...standardRules('badminton'), rubbers: 3, tie: { rubbers: [R(1)], win: 'first' } })?.error).toMatch(/not both/);
  const davis: TieSpec = { rubbers: [R(1, 1), R(2, 1), R(3, 2), R(4, 1)], win: 'first', firstTo: 3 };
  const members = new Set(['a', 'b', 'c']);
  const lineup = { R1: ['a'], R2: ['b'], R3: ['a', 'b'], R4: ['a'] }; // reverse singles: a plays twice
  expect(tieSpecLineupProblem(davis, lineup, members)).toBe('A player plays one singles at most.');
  expect(tieSpecLineupProblem({ ...davis, repeatPlayers: true }, lineup, members)).toBeNull();
});
