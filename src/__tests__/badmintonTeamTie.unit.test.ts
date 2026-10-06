/**
 * Badminton 7.16 (Oct 2026) · corporate team ties as a tournament: rubbers
 * named S1 D1 S2 D2 S3 (three: S1 D1 S2); each captain gives the order before
 * the tie — hidden from the other side until both are in, fixed once it starts,
 * a player in one singles and one doubles at most; standings rank on rubbers,
 * then games, then points.
 */
import { fakeDb } from './helpers/fakeSupabase';
import { tieOrder, rubberPlayers, stageRules, rulesRefusal } from '../utils/matchRules';
import { rankTeams } from '../utils/standings';
import { tiebreakLabel, tiebreakPresetsFor, tiebreaksFor } from '../utils/tournamentSettings';

const id = (n: number) => `ffffffff-ffff-4fff-8fff-${String(n).padStart(12, '0')}`;
const M = id(1); const T = id(2); const ORG = id(9);
const CAP_A = 'cap-a'; const CAP_B = 'cap-b';
const A = ['a1', 'a2', 'a3', 'a4', 'a5']; const B = ['b1', 'b2', 'b3', 'b4', 'b5'];
const mkDb = (status = 'scheduled') => fakeDb({
  matches: [{ id: M, sport_id: 'bd', tournament_id: T, status, rules: { bestOf: 3, target: 21, cap: 30, rubbers: 5 }, team_a_id: 'TA', team_b_id: 'TB', team_a_name: 'Infosys', team_b_name: 'TCS', umpire_id: null }],
  match_participants: [],
  team_members: [...[CAP_A, ...A].map((u) => ({ team_id: 'TA', user_id: u })), ...[CAP_B, ...B].map((u) => ({ team_id: 'TB', user_id: u }))],
  users: [...A, ...B].map((u) => ({ id: u, name: u.toUpperCase() })),
});
let db = mkDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: 'badminton' })) }));
jest.mock('../utils/tournamentAuth', () => ({ isTournamentOrganiser: jest.fn(async (_t: string, u: string) => u === ORG) }));
jest.mock('../utils/teamAuth', () => ({ isTeamManager: jest.fn(async (t: string, u: string) => (t === 'TA' && u === CAP_A) || (t === 'TB' && u === CAP_B)) }));
const sent: string[] = [];
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async (_ids: string[], n: { title: string }) => { sent.push(n.title); }) }));

// eslint-disable-next-line import/first
import { getTieLineup, setTieLineup, tieLineupProblem } from '../controllers/tieLineup.controller';

const run = async (fn: any, userId: string, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params: { id: M }, body, query: {} } as any, r);
  return r;
};
const ORDER_A = { S1: ['a1'], D1: ['a2', 'a3'], S2: ['a4'], D2: ['a1', 'a5'], S3: ['a5'] };
const ORDER_B = { S1: ['b1'], D1: ['b2', 'b3'], S2: ['b4'], D2: ['b1', 'b5'], S3: ['b5'] };
beforeEach(() => { db = mkDb(); sent.length = 0; });

test('rubbers named in the BWF order; a tie is allowed in a tournament stage', () => {
  expect(tieOrder('badminton', 5)).toEqual(['S1', 'D1', 'S2', 'D2', 'S3']);
  expect(tieOrder('badminton', 3)).toEqual(['S1', 'D1', 'S2']);
  expect(tieOrder('badminton', null)).toBeNull();
  expect(['S1', 'D1'].map(rubberPlayers)).toEqual([1, 2]);
  expect(stageRules('badminton', { default: { bestOf: 3, target: 21, cap: 30, rubbers: 5 } }, 'group')).toMatchObject({ rubbers: 5 });
  expect(rulesRefusal('badminton', { rubbers: 5 } as never)).toBeNull();
});

test('the order’s rules: every rubber filled, team members, one singles and one doubles at most', () => {
  const members = new Set(A);
  const o = ['S1', 'D1', 'S2', 'D2', 'S3'];
  expect(tieLineupProblem(o, ORDER_A, members)).toBeNull();
  expect(tieLineupProblem(o, { ...ORDER_A, S3: [] }, members)).toBe('S3 needs a player.');
  expect(tieLineupProblem(o, { ...ORDER_A, D1: ['a2'] }, members)).toBe('D1 needs two players.');
  expect(tieLineupProblem(o, { ...ORDER_A, D1: ['a2', 'a2'] }, members)).toBe('D1 needs two different players.');
  expect(tieLineupProblem(o, { ...ORDER_A, S3: ['a1'] }, members)).toBe('A player plays one singles at most.');
  expect(tieLineupProblem(o, { ...ORDER_A, D2: ['a2', 'a5'] }, members)).toBe('A player plays one doubles at most.');
  expect(tieLineupProblem(o, { ...ORDER_A, S1: ['b1'] }, members)).toBe('Everyone in the order has to be in the team (S1).');
  expect(tieLineupProblem(o, { ...ORDER_A, X9: ['a1'] }, members)).toBe('This tie has no rubber “X9”.');
});

test('captains give orders; each is hidden from the other side until both are in', async () => {
  expect((await run(setTieLineup, CAP_B, { side: 'A', lineup: ORDER_A })).statusCode).toBe(403);
  expect((await run(setTieLineup, CAP_A, { side: 'A', lineup: ORDER_A })).body).toEqual({ ok: true, both_in: false });
  // a1 plays S1 and D2: one row, both rubbers
  expect(db.t('match_participants').find((p) => p.user_id === 'a1')).toMatchObject({ team_side: 'A', role: 'tie:S1,D2' });
  const seenByB = (await run(getTieLineup, CAP_B)).body;
  expect(seenByB.order).toEqual(['S1', 'D1', 'S2', 'D2', 'S3']);
  expect(seenByB.sides.A).toMatchObject({ submitted: true, lineup: null });
  expect(seenByB.sides.B).toMatchObject({ submitted: false, can_set: true });
  expect(seenByB.sides.B.members.map((m: any) => m.id)).toEqual([CAP_B, ...B]);
  expect((await run(getTieLineup, ORG)).body.sides.A.lineup.D2.map((p: any) => p.name)).toEqual(['A1', 'A5']);
  await run(setTieLineup, CAP_B, { side: 'B', lineup: ORDER_B });
  expect(sent).toEqual(['Both orders are in']);
  const after = (await run(getTieLineup, CAP_B)).body;
  expect(after.sides.A.lineup.S1).toEqual([{ id: 'a1', name: 'A1' }]);
  // a change replaces the side's order
  expect((await run(setTieLineup, CAP_A, { side: 'A', lineup: { ...ORDER_A, S1: ['a3'], D1: ['a2', 'a4'], S2: ['a1'] } })).statusCode).toBe(200);
  expect(db.t('match_participants').filter((p) => p.team_side === 'A').map((p) => [p.user_id, p.role]).sort()).toEqual([['a1', 'tie:S2,D2'], ['a2', 'tie:D1'], ['a3', 'tie:S1'], ['a4', 'tie:D1'], ['a5', 'tie:D2,S3']]);
  expect(db.t('match_participants').filter((p) => p.team_side === 'B')).toHaveLength(5); // the other side untouched
});

test('fixed once the tie starts; a bad order is refused, worded', async () => {
  expect((await run(setTieLineup, CAP_A, { side: 'A', lineup: { ...ORDER_A, S3: ['a1'] } })).body).toMatchObject({ code: 'BAD_LINEUP', error: 'A player plays one singles at most.' });
  db = mkDb('live');
  expect((await run(setTieLineup, CAP_A, { side: 'A', lineup: ORDER_A })).body.code).toBe('LINEUP_LOCKED');
  expect((await run(getTieLineup, CAP_A)).body).toMatchObject({ locked: true });
});

test('the table: ties won, then rubbers, games and points (BWF team)', () => {
  // three companies, each won one tie 3–2 → rubbers level; games decide
  const s = (a: number[], b: number[], ra: number, rb: number) => ({ A: { score: ra, sets: a }, B: { score: rb, sets: b }, rubbers: [] });
  const ms = [
    { team_a_id: 'X', team_b_id: 'Y', winner_team_id: 'X', status: 'completed', score_summary: s([21, 21, 21, 21, 21, 10, 10, 21, 10, 10], [10, 10, 10, 10, 10, 21, 21, 10, 21, 21], 3, 2) },
    { team_a_id: 'Y', team_b_id: 'Z', winner_team_id: 'Y', status: 'completed', score_summary: s([21, 21, 21, 21, 21, 21, 10, 10], [10, 10, 10, 10, 10, 10, 21, 21], 3, 2) },
    { team_a_id: 'Z', team_b_id: 'X', winner_team_id: 'Z', status: 'completed', score_summary: s([21, 21, 21, 21, 21, 21, 10, 10, 10], [10, 10, 10, 10, 10, 10, 21, 21, 21], 3, 2) },
  ];
  const order = rankTeams(['X', 'Y', 'Z'], ms as never[], ['head_to_head', 'score_diff', 'games_diff', 'points_diff'] as never[], { win: 1, draw: 0.5, loss: 0 });
  // games: X +2 −2 … computed: X 6–4 & 3–6 → +(-1); Y 4–6 & 6–2 → +2; Z 2–6 & 6–3 → −1
  expect(order[0]).toBe('Y');
  expect(tiebreakLabel('badminton', 'score_diff', true)).toBe('Rubber difference');
  expect(tiebreakLabel('badminton', 'games_diff')).toBe('Games difference');
  expect(tiebreaksFor('badminton')).toContain('games_diff');
  expect(tiebreaksFor('cricket')).not.toContain('games_diff');
  expect(tiebreakPresetsFor('badminton', true).find((p) => p.key === 'bwf_team')!.order).toEqual(['head_to_head', 'score_diff', 'games_diff', 'points_diff']);
  expect(tiebreakPresetsFor('badminton').find((p) => p.key === 'bwf_team')).toBeUndefined();
});
