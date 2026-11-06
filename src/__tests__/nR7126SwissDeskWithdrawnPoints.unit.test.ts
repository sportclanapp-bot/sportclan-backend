/**
 * N-R7-126 (REG-058, 6 Nov 2026): the Pairings desk showed a player's points without his games
 * against a player who has since withdrawn. Seed 1 beat P5 in round 1, P5 withdrew: the pairing
 * counts that win (Audit #58, scoreIds) and pairs seed 1 with another winner, but the desk read
 * 'P01, 0 points' because getSwiss summed the points over the approved players only (ctx.ids).
 */
import { res } from './r6Mock';

jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async () => undefined) }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true), isPairingsArbiter: jest.fn(async () => true) }));
const P = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// Round 1 of 4 (no check): P1 beat P5, P2 beat P6, P3 beat P7, P4 beat P8; then P5 withdrew.
const ms = [[1, 5], [2, 6], [3, 7], [4, 8]].map(([a, b], i) => ({ id: `m${i}`, team_a_id: P(a!), team_b_id: P(b!), winner_team_id: P(a!), status: 'completed', score_summary: {}, scheduled_at: null, overs: null, round: 1, match_no: i }));
const ids = [1, 2, 3, 4, 6, 7, 8].map(P);
const sw = { rounds: 4, paired: 1, requests: {}, tpn: [1, 2, 3, 4, 5, 6, 7, 8].map(P) };
const ctx = { t: { id: T, settings: { swiss: sw } }, settings: { swiss: sw }, sw, ids, scoreIds: [...ids, P(5)], nameOf: new Map([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [P(i), `P0${i}`])),
  clubOf: () => null, ms, pts: { win: 1, draw: 0.5, loss: 0 }, slug: 'chess', colours: true };
jest.mock('../controllers/tournaments.controller', () => ({
  ...jest.requireActual('../controllers/tournaments.controller'),
  swissContext: jest.fn(async () => ctx),
  swissRepairDraft: jest.fn(async (c: unknown) => c),
}));
// eslint-disable-next-line import/first
import { getSwiss } from '../controllers/swiss.controller';

test('REG-058: a win over a player who withdrew still shows in the desk points', async () => {
  const r = res();
  await getSwiss({ userId: 'u-org', params: { id: T }, body: {}, query: {}, headers: {} } as any, r);
  expect(r.statusCode).toBe(200);
  const pts = Object.fromEntries((r.body.players as Array<{ name: string; points: number }>).map((p) => [p.name, p.points]));
  expect(pts.P01).toBe(1);
  expect(pts.P02).toBe(1);
  expect(pts.P06).toBe(0);
  expect(Object.keys(pts)).not.toContain('P05'); // the withdrawn player is not on the desk
});
