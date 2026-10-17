/**
 * E-111 (Round 6): abandon was the one result-ending write with no scoring
 * lease check — a named scorer (or any second official) without the pad could
 * abandon a match another phone was scoring, and on a knockout fixture award
 * the walkover. Now, like complete and the toss, only the phone holding the pad.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { abandonMatch } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const M = '11111111-1111-4111-8111-111111111111';
const req = (userId: string, device: string | null) => ({ userId, params: { id: M }, body: {}, header: (h: string) => (h.toLowerCase() === 'x-device-id' ? device : undefined) }) as any;
const now = new Date().toISOString();
const seed = (lease: boolean) => fakeDb({
  matches: [{ id: M, created_by: 'creator', umpire_id: 'ump', scorer_id: 'sco', status: 'scheduled', tournament_id: null, team_a_id: 'A', team_b_id: 'B' }],
  match_scoring_leases: lease ? [{ match_id: M, user_id: 'ump', device_id: 'pad', claimed_at: now, heartbeat_at: now }] : [],
});

test('the scorer can’t abandon while the umpire’s phone holds the pad', async () => {
  db = seed(true);
  const r = res();
  await abandonMatch(req('sco', 'other-phone'), r);
  expect([r.statusCode, r.body.code]).toEqual([409, 'LEASE_LOST']);
  expect(db.t('matches')[0]!.status).toBe('scheduled');
});

test('the phone holding the pad can abandon', async () => {
  db = seed(true);
  const r = res();
  await abandonMatch(req('ump', 'pad'), r);
  expect(r.statusCode).toBe(200);
  expect(db.t('matches')[0]!.status).toBe('abandoned');
});

test('with nobody on the pad, an official can abandon as before', async () => {
  db = seed(false);
  const r = res();
  await abandonMatch(req('sco', 'any'), r);
  expect(r.statusCode).toBe(200);
  expect(db.t('matches')[0]!.status).toBe('abandoned');
});
