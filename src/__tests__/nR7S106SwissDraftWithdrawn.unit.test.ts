/**
 * N-R7-S106 (Step 2, Batch 8 · SP-CHS-S12): Swiss with "check each round" on. Round 2 was drafted
 * for the arbiter, then P06 withdrew (PATCH entry 'withdrawn' → 200). The draft still held P06 and
 * Publish paired them ('P02 v Player'). Only a bye change re-paired a draft (writeBye); a withdrawal
 * didn't. A draft that holds a player who is no longer an approved entry is now paired again, when the
 * entry changes, when the desk is read, and at Publish before the round is written.
 */
import * as fs from 'fs';
import * as path from 'path';
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async () => undefined) }));
jest.mock('../utils/entryLineups', () => ({ fillEntryLineups: jest.fn(async () => undefined) }));
const P = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
// Round 1 of 6: P1 beat P4, P2 beat P5, P3 beat P6. The round-2 draft (P1–P2, P3–P4, P5–P6) waits for the arbiter.
const ms = [[1, 4], [2, 5], [3, 6]].map(([a, b], i) => ({ id: `m${i}`, team_a_id: P(a!), team_b_id: P(b!), winner_team_id: P(a!), status: 'completed', score_summary: {}, scheduled_at: null, overs: null, round: 1 }));
const draft = { round: 2, pairs: [{ white: P(1), black: P(2) }, { white: P(4), black: P(3) }, { white: P(6), black: P(5) }], bye: null };
const ctxWith = (ids: string[]) => {
  const sw = { rounds: 5, paired: 1, check: true, requests: {}, draft, tpn: [1, 2, 3, 4, 5, 6].map(P) };
  return { t: { id: T, created_by: ORG, settings: { swiss: sw } }, settings: { swiss: sw }, sw, ids, scoreIds: [1, 2, 3, 4, 5, 6].map(P),
    nameOf: new Map(ids.map((id) => [id, `P0${Number(id.slice(-2))}`])), clubOf: () => null, ms, pts: { win: 1, draw: 0.5, loss: 0 }, slug: 'chess', colours: true };
};
const insert = jest.fn();
let ctxNow = ctxWith([1, 2, 3, 4, 5].map(P)); // P6 withdrew after the draft was made
jest.mock('../controllers/tournaments.controller', () => ({
  ...jest.requireActual('../controllers/tournaments.controller'),
  swissContext: jest.fn(async () => ctxNow),
  swissInsertRound: (...a: unknown[]) => insert(...a),
}));
// eslint-disable-next-line import/first
import { publishSwissRound } from '../controllers/swiss.controller';

beforeEach(() => {
  insert.mockClear(); mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:tournaments' && q.some((c) => c.startsWith('update:'))) return { data: [{ id: T }] };
    if (q[0] === 'from:tournaments') return { data: { id: T, created_by: ORG, parent_id: null } };
    return { data: [] };
  };
});

test('SP-CHS-S12: Publish never pairs a player who withdrew while the draft waited', async () => {
  ctxNow = ctxWith([1, 2, 3, 4, 5].map(P));
  const r = res();
  await publishSwissRound({ userId: ORG, params: { id: T }, body: {}, query: {}, headers: {} } as any, r);
  expect(r.statusCode).toBe(200);
  const round = insert.mock.calls[0]![2].round as { pairs: Array<{ white: string; black: string }>; bye: string | null };
  const seated = [...round.pairs.flatMap((p) => [p.white, p.black]), ...(round.bye ? [round.bye] : [])];
  expect(seated).not.toContain(P(6));
  expect(new Set(seated)).toEqual(new Set([1, 2, 3, 4, 5].map(P))); // the other five: two games and a bye
  expect(round.bye).not.toBeNull();
});

test('a draft with only approved entries is published exactly as drafted (arbiter swaps kept)', async () => {
  ctxNow = ctxWith([1, 2, 3, 4, 5, 6].map(P));
  const r = res();
  await publishSwissRound({ userId: ORG, params: { id: T }, body: {}, query: {}, headers: {} } as any, r);
  expect(insert.mock.calls[0]![2].round).toEqual({ pairs: draft.pairs, bye: null });
});

test('the entry change and the desk read re-pair the draft too', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
  const at = src.indexOf('walkoverOnWithdraw(id, entry.team_id)');
  expect(src.slice(at, at + 900)).toMatch(/swissRepairDraft\(/);
  const sw = fs.readFileSync(path.join(__dirname, '../controllers/swiss.controller.ts'), 'utf8');
  const g = sw.indexOf('export async function getSwiss');
  expect(sw.slice(g, g + 700)).toMatch(/swissRepairDraft\(/);
});
