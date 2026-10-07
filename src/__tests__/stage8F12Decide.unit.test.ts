/**
 * Stage 8 · F12 · an abandoned match's result stands, the rest is replayed, or
 * it's awarded (any sport); the organiser only; a reason always.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `ffffffff-ffff-4fff-8fff-${String(n).padStart(12, '0')}`;
const T = id(1); const ORG = id(2); const P = id(3); const M = id(10); const TA = id(20); const TB = id(21);
const base = (extra: object = {}) => ({ id: M, sport_id: 'sp', tournament_id: T, created_by: ORG, status: 'abandoned', round: 1, group_label: 'A', next_match_id: null, team_a_id: TA, team_b_id: TB, team_a_name: 'Lions', team_b_name: 'Tigers', format: null, overs: null, rules: null, score_summary: { A: { score: 2 }, B: { score: 1 } }, voided_at: null, ...extra });
let db = fakeDb({});
let bracket = false;
const mk = (m: object) => fakeDb({ matches: [m], tournaments: [{ id: T, created_by: ORG, parent_id: null }], tournament_organisers: [] });
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: 'football' })), normSportSlug: (s: string) => s }));
jest.mock('../utils/knockout', () => ({ isKnockoutBracketMatch: jest.fn(async () => bracket) }));
const advanced: string[] = [];
jest.mock('../controllers/tournaments.controller', () => ({ advanceTournamentWinner: jest.fn(async (mid: string) => { advanced.push(mid); }), tournamentSettingsOf: jest.fn(async () => ({})) }));
const told: string[] = [];
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async (_ids: string[], n: { body: string }) => { told.push(n.body); }), matchAudienceIds: jest.fn(async () => ['u']) }));

// eslint-disable-next-line import/first
import { decideMatch, scoreNow } from '../controllers/matchDecision.controller';

const run = async (userId: string, body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await decideMatch({ userId, params: { id: M }, body, query: {} } as any, r);
  return r;
};
const row = () => db.t('matches')[0]!;
beforeEach(() => { bracket = false; advanced.length = 0; told.length = 0; });

test('the result stands: the score when it stopped; told why; the table/bracket advance', async () => {
  db = mk(base());
  const r = await run(ORG, { decision: 'stands', reason: 'Floodlights failed at 63’' });
  expect(r.statusCode).toBe(200);
  expect([row().status, row().winner_team_id, row().result_type, row().score_summary.result]).toEqual(['completed', TA, 'decisive', 'Lions won 2–1 (result stands)']);
  expect(row().score_summary.decision).toMatchObject({ kind: 'stands', reason: 'Floodlights failed at 63’' });
  expect(advanced).toEqual([M]);
  expect(told[0]).toBe('The match result stands — Floodlights failed at 63’');
});

test('level: a draw stands in a league, not in a knockout', async () => {
  db = mk(base({ score_summary: { A: { score: 1 }, B: { score: 1 } } }));
  expect((await run(ORG, { decision: 'stands', reason: 'Rain' })).body.match.result_type).toBe('draw');
  bracket = true;
  db = mk(base({ score_summary: { A: { score: 1 }, B: { score: 1 } }, group_label: null }));
  expect((await run(ORG, { decision: 'stands', reason: 'Rain' })).body.code).toBe('LEVEL_KNOCKOUT');
});

test('replay the rest: back to scheduled, the score kept, nothing advanced', async () => {
  db = mk(base({ status: 'live' }));
  const r = await run(ORG, { decision: 'replay', reason: 'Bad light', at: '2026-11-20T04:30:00.000Z' });
  expect([row().status, row().winner_team_id, row().scheduled_at, row().score_summary.A.score]).toEqual(['scheduled', null, '2026-11-20T04:30:00.000Z', 2]);
  expect(r.body.match.score_summary.decision.kind).toBe('replay');
  expect(advanced).toEqual([]);
});

test('awarded: to a side, the sport’s walkover score or one given; refusals', async () => {
  db = mk(base({ status: 'scheduled', score_summary: {} }));
  const r = await run(ORG, { decision: 'awarded', reason: 'Tigers fielded an ineligible player', winner_side: 'A' });
  expect([row().status, row().result_type, row().winner_team_id, row().score_summary.result]).toEqual(['completed', 'awarded', TA, 'Lions awarded the match 3–0']);
  db = mk(base({ status: 'abandoned' }));
  await run(ORG, { decision: 'awarded', reason: 'No-show', winner_side: 'B', score: { A: 0, B: 5 } });
  expect([row().winner_team_id, row().score_summary.team_b_score, row().score_summary.result]).toEqual([TB, 5, 'Tigers awarded the match 5–0']);
  db = mk(base());
  expect((await run(ORG, { decision: 'awarded', reason: 'x', winner_side: 'B', score: { A: 3, B: 1 } })).body.code).toBe('BAD_SCORE');
  expect((await run(ORG, { decision: 'awarded', reason: 'x' })).body.code).toBe('WINNER_REQUIRED');
  expect((await run(ORG, { decision: 'awarded', winner_side: 'A' })).body.code).toBe('REASON_REQUIRED');
  expect((await run(P, { decision: 'awarded', reason: 'x', winner_side: 'A' })).statusCode).toBe(403);
  db = mk(base({ status: 'completed' }));
  expect((await run(ORG, { decision: 'awarded', reason: 'x', winner_side: 'A' })).body.code).toBe('MATCH_FINISHED');
});

test('scoreNow reads goals, or sets won', () => {
  expect(scoreNow({ A: { score: 2 }, B: { score: 0 } })).toEqual({ A: 2, B: 0 });
  expect(scoreNow({ A: { sets: [21, 15, 21] }, B: { sets: [18, 21, 10] } })).toEqual({ A: 2, B: 1 });
  expect(scoreNow({})).toBeNull();
});
