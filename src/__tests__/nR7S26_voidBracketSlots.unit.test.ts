/**
 * N-R7-S26 (Step 2 · Batch 10 · SPP2-VOL-050): voiding a knockout match took
 * it off every record but left its winner in the next round (and, in a double
 * elimination, its loser in the back draw) — a voided result still decided the
 * bracket. A void now empties those slots while the next matches are unplayed,
 * is refused once one has been played, and a restore puts the teams back.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
const mockAdvance = jest.fn(async () => undefined);
jest.mock('../controllers/tournaments.controller', () => ({ ...jest.requireActual('../controllers/tournaments.controller'), advanceTournamentWinner: (...a: unknown[]) => (mockAdvance as any)(...a), recrownAfterVoidChange: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { voidMatch, unvoidMatch } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const T = 't1'; const M = '11111111-1111-4111-8111-111111111111'; const N = '22222222-2222-4222-8222-222222222222'; const BK = '33333333-3333-4333-8333-333333333333';
const seed = (nextStatus = 'scheduled', backStatus = 'scheduled') => {
  db = fakeDb({
    sports: [{ id: 's', slug: 'volleyball' }],
    tournaments: [{ id: T, organizer_id: 'org', format: 'knockout', status: 'live', settings: { v: 1, doubleElim: true } }],
    matches: [
      { id: M, sport_id: 's', tournament_id: T, created_by: 'org', umpire_id: 'org', status: 'completed', completed_at: new Date().toISOString(), voided_at: null, round: 2, group_label: null, bracket: null, team_a_id: 'A', team_b_id: 'B', team_a_name: 'A', team_b_name: 'B', winner_team_id: 'A', next_match_id: N, next_slot: 'A', loser_next_match_id: BK, loser_next_slot: 'B', score_summary: {} },
      { id: N, sport_id: 's', tournament_id: T, status: nextStatus, voided_at: null, round: 3, bracket: 'final', team_a_id: 'A', team_b_id: null, team_a_name: 'A', team_b_name: 'TBD', next_match_id: null },
      { id: BK, sport_id: 's', tournament_id: T, status: backStatus, voided_at: null, round: 2, bracket: 'back', team_a_id: null, team_b_id: 'B', team_a_name: 'TBD', team_b_name: 'B', next_match_id: null },
    ],
  });
};
const row = (id: string) => db.t('matches').find((m: any) => m.id === id)!;

test('a void empties the winner’s next slot and the loser’s back-draw slot', async () => {
  seed(); const r = res();
  await voidMatch({ userId: 'org', params: { id: M }, body: { reason: 'Wrong result' } } as any, r);
  expect(r.statusCode).toBe(200);
  expect([row(N).team_a_id, row(N).team_a_name]).toEqual([null, 'TBD']);
  expect([row(BK).team_b_id, row(BK).team_b_name]).toEqual([null, 'TBD']);
});

test('refused once a later match it fed has been played; nothing changes', async () => {
  seed('scheduled', 'completed'); const r = res();
  await voidMatch({ userId: 'org', params: { id: M }, body: { reason: 'Wrong result' } } as any, r);
  expect([r.statusCode, r.body.code]).toEqual([409, 'NEXT_ROUND_PLAYED']);
  expect(row(M).voided_at).toBeNull();
  expect(row(N).team_a_id).toBe('A');
});

test('a restore puts the result back into the bracket', async () => {
  seed(); await voidMatch({ userId: 'org', params: { id: M }, body: { reason: 'Wrong result' } } as any, res());
  mockAdvance.mockClear(); const r = res();
  await unvoidMatch({ userId: 'org', params: { id: M } } as any, r);
  expect(r.statusCode).toBe(200);
  expect(mockAdvance).toHaveBeenCalledWith(M);
});
