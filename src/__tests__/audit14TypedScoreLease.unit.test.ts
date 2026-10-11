/**
 * Audit #14 (11 Oct 2026): a typed score only checked "may officiate", so a
 * second phone could write a whole result while someone else held the scoring
 * pad (and on a deactivated sport). It now uses the live scorer's gate.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
let leaseOk = true;
let inactive = false;
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canOfficiateMatch: jest.fn(async () => true) }));
jest.mock('../utils/scoringLease', () => ({
  ...jest.requireActual('../utils/scoringLease'),
  checkLease: jest.fn(async () => (leaseOk ? { ok: true } : { ok: false, reason: 'held', lease: { holder_id: 'other', device_id: 'phone-2' } })),
}));
jest.mock('../utils/sportCache', () => ({
  ...jest.requireActual('../utils/sportCache'),
  getSport: jest.fn(async () => ({ slug: 'football', allows_draw: true })),
}));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => inactive) }));

// eslint-disable-next-line import/first
import { typedScore } from '../controllers/scoring.controller';

const M = 'mmmmmmmm-mmmm-4mmm-8mmm-000000000014';
const call = async () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await typedScore({ userId: 'me', params: { id: M }, body: { A: 2, B: 1 }, headers: {}, get: () => undefined, header: () => undefined } as any, r);
  return r;
};

describe('audit #14: a typed score respects the scoring pad', () => {
  beforeEach(() => {
    leaseOk = true; inactive = false;
    db = fakeDb({ matches: [{ id: M, sport_id: 's-fb', status: 'live', voided_at: null, rules: {}, format: null, overs: null, created_by: 'me', umpire_id: null, scorer_id: null, tournament_id: null, team_a_id: null, team_b_id: null }], match_events: [] });
  });
  it('refused (409) while another phone holds the pad, and nothing is written', async () => {
    leaseOk = false;
    const r = await call();
    expect(r.statusCode).toBe(409);
    expect(db.t('match_events')).toHaveLength(0);
  });
  it('refused on a deactivated sport', async () => {
    inactive = true;
    const r = await call();
    expect(r.body.code).toBe('SPORT_INACTIVE');
  });
});
