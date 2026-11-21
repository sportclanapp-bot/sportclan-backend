/**
 * Q29 (Dipak, 21 Nov 2026: A) · N-R3C2-7: an awarded match with no score typed takes the sport's
 * official forfeit score (hockey 5–0, basketball 20–0, volleyball straight sets 25–0, football 3–0);
 * a sport with none (cricket, tennis…) is asked for a score. It kept the live score, so the side it
 * was awarded to showed as losing ('Hoop awarded the match 2–0' to the side on 0).
 */
import { fakeDb } from './helpers/fakeSupabase';
import { awardForfeitScore } from '../utils/walkoverScore';
import { standardRules } from '../utils/matchRules';

const id = (n: number) => `ffffffff-ffff-4fff-8fff-${String(n).padStart(12, '0')}`;
const T = id(1); const ORG = id(2); const M = id(10); const TA = id(20); const TB = id(21);
let slug = 'hockey';
let settings: Record<string, unknown> = {};
const base = (extra: object = {}) => ({ id: M, sport_id: 'sp', tournament_id: T, created_by: ORG, status: 'abandoned', round: 1, group_label: 'A', next_match_id: null, team_a_id: TA, team_b_id: TB, team_a_name: 'Dunk', team_b_name: 'Hoop', format: null, overs: null, rules: null, voided_at: null, ...extra });
let db = fakeDb({});
const mk = (m: object) => fakeDb({ matches: [m], tournaments: [{ id: T, created_by: ORG, parent_id: null }], tournament_organisers: [] });
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug })), normSportSlug: (s: string) => s }));
jest.mock('../utils/knockout', () => ({ isKnockoutBracketMatch: jest.fn(async () => false) }));
jest.mock('../controllers/tournaments.controller', () => ({ advanceTournamentWinner: jest.fn(async () => undefined), tournamentSettingsOf: jest.fn(async () => settings) }));
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));

// eslint-disable-next-line import/first
import { decideMatch } from '../controllers/matchDecision.controller';

const run = async (body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await decideMatch({ userId: ORG, params: { id: M }, body, query: {} } as any, r);
  return r;
};
const row = () => db.t('matches')[0]!;
const award = (side: 'A' | 'B') => run({ decision: 'awarded', reason: 'No-show', winner_side: side });
beforeEach(() => { settings = {}; });

test('the official forfeit figures, the tournament’s own first', () => {
  expect(awardForfeitScore('hockey', standardRules('hockey'))).toBe(5);
  expect(awardForfeitScore('basketball', standardRules('basketball'))).toBe(20);
  expect(awardForfeitScore('football', standardRules('football'))).toBe(3);
  expect(awardForfeitScore('volleyball', standardRules('volleyball'))).toBe(3);
  expect(awardForfeitScore('volleyball', { ...standardRules('volleyball'), bestOf: 3 })).toBe(2);
  expect(awardForfeitScore('chess', standardRules('chess'))).toBe(1);
  expect(awardForfeitScore('hockey', standardRules('hockey'), { walkoverScore: 3 })).toBe(3);
  for (const s of ['cricket', 'tennis', 'badminton', 'table-tennis', 'pickleball', 'carrom']) expect(awardForfeitScore(s, standardRules(s))).toBeNull();
  expect(awardForfeitScore('tennis', standardRules('tennis'), { walkoverScore: 'straight' })).toBe(2);
});

test('hockey 1–2 awarded to the side behind: 5–0 to them, not the live 1–2', async () => {
  slug = 'hockey';
  db = mk(base({ score_summary: { A: { score: 1 }, B: { score: 2 } } }));
  expect((await award('A')).statusCode).toBe(200);
  expect([row().winner_team_id, row().score_summary.A.score, row().score_summary.B.score, row().score_summary.result]).toEqual([TA, 5, 0, 'Dunk awarded the match 5–0']);
});

test('basketball 0–2 (team_a_score kept by the pad) awarded to A: 20–0', async () => {
  slug = 'basketball';
  db = mk(base({ score_summary: { A: { score: 0 }, B: { score: 2 }, team_a_score: 0, team_b_score: 2 } }));
  await award('A');
  expect([row().score_summary.team_a_score, row().score_summary.team_b_score, row().score_summary.result]).toEqual([20, 0, 'Dunk awarded the match 20–0']);
});

test('volleyball: straight sets at 25–0', async () => {
  slug = 'volleyball';
  db = mk(base({ rules: { bestOf: 3 }, score_summary: { A: { sets: [25] }, B: { sets: [20] } } }));
  await award('B');
  expect([row().score_summary.B.sets, row().score_summary.A.sets, row().score_summary.result]).toEqual([[25, 25], [0, 0], 'Hoop awarded the match 2–0']);
});

test('cricket / tennis: no official forfeit score — asked for one; a typed one is taken', async () => {
  slug = 'cricket';
  db = mk(base({ score_summary: { A: { runs: 120, balls: 60 }, B: { runs: 0, balls: 0 } } }));
  const r = await award('B');
  expect([r.statusCode, r.body.code, r.body.error]).toEqual([400, 'SCORE_REQUIRED', 'Cricket has no official forfeit score. Type the score it’s awarded at.']);
  expect(row().status).toBe('abandoned');
  await run({ decision: 'awarded', reason: 'No-show', winner_side: 'B', score: { A: 0, B: 1 } });
  expect([row().status, row().score_summary.result]).toEqual(['completed', 'Hoop awarded the match 1–0']);
  slug = 'tennis';
  db = mk(base({ score_summary: { A: { sets: [6] }, B: { sets: [3] } } }));
  expect((await award('B')).body.code).toBe('SCORE_REQUIRED');
  settings = { walkoverScore: 'straight' };
  await award('B');
  expect(row().score_summary.result).toBe('Hoop awarded the match 2–0');
});
