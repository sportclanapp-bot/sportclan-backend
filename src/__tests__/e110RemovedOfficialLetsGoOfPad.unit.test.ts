/**
 * E-110 (Round 6): an umpire or scorer taken off a match kept the scoring pad —
 * their open screen's heartbeat kept the lease fresh, so the creator or the new
 * official got LEASE_HELD, and a takeover was refused (LEASE_ACTIVE) until five
 * minutes after that phone stopped. Naming someone else now lets the old lease
 * go, a removed official's heartbeat is refused, and a claim or takeover treats
 * a lease held by a former official as free.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { setMatchOfficials, heartbeatScoringLease, claimScoringLease, takeOverScoringLease } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const M = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';
const req = (userId: string, device: string | null, body: object = {}) => ({ userId, params: { id: M }, body, header: (h: string) => (h.toLowerCase() === 'x-device-id' ? device : undefined) }) as any;
const fresh = () => new Date().toISOString();
const seed = (umpire: string | null) => fakeDb({
  sports: [{ id: 's', slug: 'cricket' }],
  users: [{ id: 'creator' }, { id: 'old-ump' }, { id: NEW, deleted_at: null }],
  matches: [{ id: M, sport_id: 's', created_by: 'creator', umpire_id: umpire, scorer_id: null, status: 'live', tournament_id: null, is_ranked: false, team_a_id: 'A', team_b_id: 'B' }],
  match_officials: [],
  match_scoring_leases: [{ match_id: M, user_id: 'old-ump', device_id: 'old-pad', claimed_at: fresh(), heartbeat_at: fresh() }],
});

test('naming another umpire lets the old umpire’s pad go', async () => {
  db = seed('old-ump');
  const r = res();
  await setMatchOfficials(req('creator', 'c-phone', { umpire_id: NEW }), r);
  expect(r.statusCode).toBe(200);
  expect(db.t('match_scoring_leases')).toHaveLength(0);
  const c = res();
  await claimScoringLease(req(NEW, 'new-pad'), c);
  expect(c.statusCode).toBe(200);
  expect(c.body.lease.user_id).toBe(NEW);
});

test('a removed umpire’s heartbeat is refused and does not keep the pad', async () => {
  db = seed(null); // already taken off the match
  const r = res();
  await heartbeatScoringLease(req('old-ump', 'old-pad'), r);
  expect([r.statusCode, r.body.code]).toEqual([409, 'LEASE_LOST']);
  expect(db.t('match_scoring_leases')).toHaveLength(0);
});

test('the creator claims a pad a removed umpire still holds', async () => {
  db = seed(null);
  const r = res();
  await claimScoringLease(req('creator', 'c-phone'), r);
  expect(r.statusCode).toBe(200);
  expect(r.body.lease.user_id).toBe('creator');
});

test('a takeover of a removed umpire’s fresh pad goes through', async () => {
  db = seed(null);
  const r = res();
  await takeOverScoringLease(req('creator', 'c-phone', { reason: 'umpire removed' }), r);
  expect(r.statusCode).toBe(200);
});

test('a current umpire’s heartbeat still keeps the pad', async () => {
  db = seed('old-ump');
  const r = res();
  await heartbeatScoringLease(req('old-ump', 'old-pad'), r);
  expect(r.statusCode).toBe(200);
  expect(db.t('match_scoring_leases')).toHaveLength(1);
});
