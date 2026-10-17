/**
 * E-122 (Round 6): an umpire could be reviewed by anyone in ANY match naming
 * them — scheduled, cancelled or voided, never played. Now it takes a match
 * that was played (completed, not voided), the officiated count's rule.
 * E-123 (Round 6): a legacy 'referee' officiates (OFFICIATING_TYPES) and their
 * profile offers Review, but the gate treated them as a player and always
 * refused ('Players are rated by their match record'). They are gated like an
 * umpire now.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { submitReview } from '../controllers/users.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const review = async (type: string, match: { status: string; voided_at?: string | null }) => {
  db = fakeDb({
    user_account_types: [{ user_id: 'off', account_type: type }],
    match_participants: [{ match_id: 'm', user_id: 'me', match: { umpire_id: 'off', voided_at: null, ...match } }],
  });
  const r = res();
  await submitReview({ userId: 'me', params: { id: 'off' }, body: { rating: 4 } } as any, r);
  return r;
};

describe('E-122 · only a played match lets a player review its umpire', () => {
  test('a completed match: allowed', async () => {
    expect((await review('umpire', { status: 'completed' })).statusCode).toBe(200);
  });
  test.each(['scheduled', 'cancelled', 'live'])('a %s match: refused', async (status) => {
    const r = await review('umpire', { status });
    expect([r.statusCode, r.body.code]).toEqual([403, 'REVIEW_NOT_ELIGIBLE']);
  });
  test('a voided match: refused', async () => {
    const r = await review('official', { status: 'completed', voided_at: '2026-10-01T00:00:00Z' });
    expect([r.statusCode, r.body.code]).toEqual([403, 'REVIEW_NOT_ELIGIBLE']);
  });
});

describe('E-123 · a legacy referee is reviewed like an umpire', () => {
  test('by a player they officiated', async () => {
    const r = await review('referee', { status: 'completed' });
    expect(r.statusCode).toBe(200);
    expect(r.body.review).toMatchObject({ reviewer_id: 'me', reviewed_id: 'off', rating: 4 });
  });
  test('not by someone they never officiated', async () => {
    db = fakeDb({ user_account_types: [{ user_id: 'off', account_type: 'referee' }] });
    const r = res();
    await submitReview({ userId: 'me', params: { id: 'off' }, body: { rating: 4 } } as any, r);
    expect([r.statusCode, r.body.code]).toEqual([403, 'REVIEW_NOT_ELIGIBLE']);
  });
});
