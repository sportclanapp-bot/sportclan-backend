/**
 * N-R7-S124 (Step 2 · Batch 10 · SPP2-VOL-050; Dipak chose A, 9 Nov 2026): after a
 * wrong main-draw final was voided, nothing could enter the correct result — a
 * voided match refuses every result path — so the bracket stayed TBD. POST
 * /matches/:id/replace makes a fresh copy of the voided fixture in its place
 * (teams, line-ups, round, where its winner and loser go; the earlier rounds feed
 * the copy), marks the voided one replaced_by, is refused once a later match it
 * fed is played, and a restore still works until the copy is played.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
const mockAdvance = jest.fn(async () => undefined);
jest.mock('../controllers/tournaments.controller', () => ({ ...jest.requireActual('../controllers/tournaments.controller'), advanceTournamentWinner: (...a: unknown[]) => (mockAdvance as any)(...a), recrownAfterVoidChange: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { unvoidMatch } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { replaceVoidedMatch, replacedMatchIds } from '../controllers/matchReplace.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const T = 't1';
const M = '11111111-1111-4111-8111-111111111111'; // the voided main-draw final (A 3–0 typed by mistake)
const N = '22222222-2222-4222-8222-222222222222'; // the final (winner's next)
const BK = '33333333-3333-4333-8333-333333333333'; // the back-draw final (loser's next)
const S1 = '44444444-4444-4444-8444-444444444444'; // a semi that fed M
const now = new Date().toISOString();
const seed = (backStatus = 'scheduled', voided = true) => {
  db = fakeDb({
    sports: [{ id: 's', slug: 'volleyball' }],
    tournaments: [{ id: T, created_by: 'org', organizer_id: 'org', format: 'knockout', status: 'live', settings: { v: 1, doubleElim: true } }],
    tournament_organisers: [],
    matches: [
      { id: S1, sport_id: 's', tournament_id: T, status: 'completed', voided_at: null, replaced_by: null, round: 1, bracket: null, team_a_id: 'A', team_b_id: 'C', winner_team_id: 'A', next_match_id: M, next_slot: 'A', loser_next_match_id: null },
      { id: M, sport_id: 's', tournament_id: T, created_by: 'org', umpire_id: 'org', status: 'completed', completed_at: now, voided_at: voided ? now : null, void_reason: 'Wrong result', replaced_by: null, round: 2, match_no: 1, group_label: null, bracket: null, team_a_id: 'A', team_b_id: 'B', team_a_name: 'A', team_b_name: 'B', winner_team_id: 'A', next_match_id: N, next_slot: 'A', loser_next_match_id: BK, loser_next_slot: 'B', score_summary: { result: 'A won 3–0' }, rules: { sets: 5 }, is_ranked: true },
      { id: N, sport_id: 's', tournament_id: T, status: 'scheduled', voided_at: null, replaced_by: null, round: 3, bracket: 'final', team_a_id: null, team_b_id: null, team_a_name: 'TBD', team_b_name: 'TBD', next_match_id: null },
      { id: BK, sport_id: 's', tournament_id: T, status: backStatus, voided_at: null, replaced_by: null, round: 2, bracket: 'back', team_a_id: 'D', team_b_id: null, team_a_name: 'D', team_b_name: 'TBD', next_match_id: N },
    ],
    match_participants: [{ id: 'p1', match_id: M, user_id: 'ua', team_side: 'A', role: 'player' }, { id: 'p2', match_id: M, user_id: 'ub', team_side: 'B', role: 'player' }],
  });
};
const row = (id: string) => db.t('matches').find((m: any) => m.id === id)!;
const copies = () => db.t('matches').filter((m: any) => ![S1, M, N, BK].includes(m.id));
const replace = async (who = 'org') => { const r = res(); await replaceVoidedMatch({ userId: who, params: { id: M }, body: {} } as any, r); return r; };

test('a voided fixture gets a fresh copy in its place; the semi feeds the copy; the voided one is marked replaced', async () => {
  seed(); const r = await replace();
  expect(r.statusCode).toBe(200);
  const c = copies();
  expect(c).toHaveLength(1);
  const cp = c[0];
  expect([cp.status, cp.team_a_id, cp.team_b_id, cp.round, cp.match_no, cp.next_match_id, cp.next_slot, cp.loser_next_match_id, cp.loser_next_slot]).toEqual(['scheduled', 'A', 'B', 2, 1, N, 'A', BK, 'B']);
  // a clean match: no result, no void, its own id — its rating / coins / table rows come from its own completion only
  expect([cp.winner_team_id ?? null, cp.score_summary ?? null, cp.voided_at ?? null, cp.completed_at ?? null]).toEqual([null, null, null, null]);
  expect(row(M).replaced_by).toBe(cp.id);
  expect(row(M).voided_at).not.toBeNull(); // stays voided: off the records, the table and the leaderboards
  expect(row(S1).next_match_id).toBe(cp.id);
  expect(db.t('match_participants').filter((p: any) => p.match_id === cp.id).map((p: any) => `${p.user_id}:${p.team_side}`).sort()).toEqual(['ua:A', 'ub:B']);
  expect(await replacedMatchIds(T)).toEqual(new Set([M]));
});

test('a finished tournament (its final voided) is live again, so the copy crowns it', async () => {
  seed(); db.t('tournaments')[0].status = 'completed';
  expect((await replace()).statusCode).toBe(200);
  expect(db.t('tournaments')[0].status).toBe('live');
});

test('a second tap makes no second copy', async () => {
  seed(); await replace(); const r = await replace();
  expect([r.statusCode, r.body.already_replaced]).toEqual([200, true]);
  expect(copies()).toHaveLength(1);
});

test('refused once a later match it fed has been played; nothing changes', async () => {
  seed('completed'); const r = await replace();
  expect([r.statusCode, r.body.code]).toEqual([409, 'NEXT_ROUND_PLAYED']);
  expect(copies()).toHaveLength(0);
  expect(row(M).replaced_by).toBeNull();
});

test('only a voided fixture, only the organiser', async () => {
  seed('scheduled', false); expect((await replace()).body.code).toBe('NOT_VOIDED');
  seed(); expect((await replace('stranger')).statusCode).toBe(403);
  expect(copies()).toHaveLength(0);
});

test('Restore still works while the copy is unplayed: the copy is cancelled, the semi feeds the original again', async () => {
  seed(); await replace(); const cp = copies()[0];
  mockAdvance.mockClear(); const r = res();
  await unvoidMatch({ userId: 'org', params: { id: M } } as any, r);
  expect(r.statusCode).toBe(200);
  expect(row(M).voided_at).toBeNull();
  expect(row(M).replaced_by).toBeNull();
  expect([row(cp.id).status, row(cp.id).replaced_by]).toEqual(['cancelled', M]); // kept, hidden from the bracket
  expect(row(S1).next_match_id).toBe(M);
  expect(mockAdvance).toHaveBeenCalledWith(M);
  expect(await replacedMatchIds(T)).toEqual(new Set([cp.id]));
});

test('Restore is refused once the copy has been played', async () => {
  seed(); await replace(); const cp = copies()[0];
  row(cp.id).status = 'live';
  const r = res(); await unvoidMatch({ userId: 'org', params: { id: M } } as any, r);
  expect([r.statusCode, r.body.code]).toEqual([409, 'REPLACEMENT_PLAYED']);
  expect(row(M).voided_at).not.toBeNull();
  expect(row(M).replaced_by).toBe(cp.id);
});

test('the bracket leaves out a replaced fixture; the route is wired', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
  const b = src.slice(src.indexOf('export async function getBracket'), src.indexOf('export async function joinByCode'));
  expect(b).toMatch(/replacedMatchIds\(/);
  expect(fs.readFileSync(path.join(__dirname, '../routes/matches.routes.ts'), 'utf8')).toMatch(/'\/:id\/replace', authenticateToken, replaceVoidedMatch/);
});
