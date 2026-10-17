/**
 * E-067 / E-062 (Round 6) · the Pairings desk of a Swiss.
 * E-067: a Swiss that is an EVENT of a tournament keeps its officials on the tournament (the parent),
 * but the desk looked them up on the event: its arbiters were refused (403) and never told anything.
 * E-062: co-organisers can decide byes and publish, but a bye request (and "Round n pairings are
 * ready") went only to the creator and the arbiters.
 */
import * as fs from 'fs';
import * as path from 'path';
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async () => undefined) }));
jest.mock('../utils/tournamentSettings', () => ({ ...jest.requireActual('../utils/tournamentSettings'), byeAskRounds: () => [2] }));
const ROOT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ARBITER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CREATOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CO_ORG = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PLAYER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ENTRY = '12121212-1212-4121-8121-121212121212';
jest.mock('../controllers/tournaments.controller', () => ({
  swissContext: jest.fn(async () => ({
    t: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', created_by: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', entry_kind: 'singles' },
    ids: ['12121212-1212-4121-8121-121212121212'], sw: { rounds: 5, paired: 1, requests: {} }, nameOf: new Map(), ms: [], settings: {},
  })),
  swissInsertRound: jest.fn(), swissLateRounds: jest.fn(), swissPairRound: jest.fn(),
}));
// eslint-disable-next-line import/first
import { setSwissBye, askSwissBye } from '../controllers/swiss.controller';
// eslint-disable-next-line import/first
import { notifyUsers } from '../utils/notify';

beforeEach(() => {
  mock.log = [];
  (notifyUsers as jest.Mock).mockClear();
  mock.next = (q) => {
    const has = (x: string) => q.some((c) => c.includes(x));
    if (q[0] === 'from:tournaments') return { data: { id: EVENT, created_by: CREATOR, parent_id: ROOT } };
    // Co-organisers and officials are kept on the parent tournament.
    if (q[0] === 'from:tournament_organisers') return { data: has(ROOT) && (!q.some((c) => c.startsWith('eq:["user_id"')) || has(CO_ORG)) ? [{ user_id: CO_ORG }] : [] };
    if (q[0] === 'from:tournament_officials') return { data: has(ROOT) && (!q.some((c) => c.startsWith('eq:["user_id"')) || has(ARBITER)) ? [{ id: 'o1', user_id: ARBITER }] : [] };
    if (q[0] === 'from:team_members') return { data: [{ team_id: ENTRY, role: 'member' }] };
    if (q[0] === 'from:swiss_bye_requests') return { data: { id: 'r1', team_id: ENTRY, round: 2, kind: 'half', status: 'pending' } };
    return { data: null };
  };
});
const req = (userId: string, body: object) => ({ userId, params: { id: EVENT }, body, query: {}, headers: {} }) as any;

test('E-067: the tournament’s pairings arbiter is not refused on the Swiss event’s desk', async () => {
  const r = res();
  await setSwissBye(req(ARBITER, { team_id: 'nobody', round: 2, kind: 'half' }), r);
  expect(r.statusCode).not.toBe(403);
});
test('a stranger is still refused', async () => {
  const r = res();
  await setSwissBye(req('99999999-9999-4999-8999-999999999999', { team_id: ENTRY, round: 2, kind: 'half' }), r);
  expect(r.statusCode).toBe(403);
});
test('E-062 / E-067: a bye request reaches the creator, the co-organisers and the tournament’s arbiters', async () => {
  const r = res();
  await askSwissBye(req(PLAYER, { team_id: ENTRY, round: 2, kind: 'half' }), r);
  expect(r.statusCode).toBe(200);
  const told = (notifyUsers as jest.Mock).mock.calls[0][0] as string[];
  expect(new Set(told)).toEqual(new Set([CREATOR, CO_ORG, ARBITER]));
});
test('E-062 / E-067: "Round n pairings are ready" goes to the same people', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
  const at = src.indexOf('pairings are ready');
  expect(src.slice(Math.max(0, at - 600), at)).toMatch(/const who = await swissDeskPeople\(tournamentId\)/);
});
