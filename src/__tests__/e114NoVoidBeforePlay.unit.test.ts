/**
 * E-114 (Round 6): POST /matches/:id/void worked on a scheduled or cancelled
 * match (the window is open until a match ends), though the app offers Void
 * only after play. A voided scheduled match could then never be finished
 * (MATCH_VOIDED) until restored. Before play the answer is Cancel.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { voidMatch } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const M = '11111111-1111-4111-8111-111111111111';
const go = async (status: string) => {
  db = fakeDb({ sports: [{ id: 's', slug: 'football' }], matches: [{ id: M, sport_id: 's', created_by: 'creator', status, tournament_id: null, voided_at: null, team_a_id: 'A', team_b_id: 'B', score_summary: {} }] });
  const r = res();
  await voidMatch({ userId: 'creator', params: { id: M }, body: { reason: 'test fixture' } } as any, r);
  return r;
};

test.each(['scheduled', 'cancelled'])('a %s match can’t be voided — nothing was played', async (status) => {
  const r = await go(status);
  expect([r.statusCode, r.body.code]).toEqual([409, 'NOT_PLAYED']);
  expect(db.t('matches')[0]!.voided_at).toBeNull();
});

test('a scheduled match is told to cancel instead', async () => {
  expect((await go('scheduled')).body.error).toBe('This match hasn’t been played, so there’s nothing to void. Cancel it instead.');
});

test('a live match can still be voided', async () => {
  const r = await go('live');
  expect(r.statusCode).toBe(200);
  expect(db.t('matches')[0]!.voided_at).toBeTruthy();
});
