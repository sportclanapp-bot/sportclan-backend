/**
 * Profile & Settings tidy-up (Dipak, 12 Oct 2026) — the server half.
 *  1. Tournaments "All" runs live → upcoming → completed → cancelled (it led with
 *     the newest-made tournament, often a cancelled one).
 *  2. Services: officials are carded by the word their sports use for one —
 *     a football referee who picked "Umpire / Referee" is under Referees (it was
 *     empty), not the cricket umpires; counts follow the city.
 *  3. A venue has its own page (GET /venues/:id).
 *  4. Play invites: the sender's Sent list, and withdrawing keeps the invite,
 *     marked 'withdrawn' (migration 153); the receiver no longer sees it.
 */
import express from 'express';
import type { AddressInfo } from 'net';
import { fakeDb } from './helpers/fakeSupabase';
import { bucketSlices } from '../utils/tournamentRules';
import { officialCategoriesOf } from '../utils/officialCategories';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));
jest.mock('../utils/blocks', () => ({ blockedUserIds: jest.fn(async () => new Set()), excludeIds: (q: unknown) => q, isBlockedBetween: jest.fn(async () => false) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUnlessBlocked: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
jest.mock('../utils/softDelete', () => ({ deleteMatching: jest.fn(async () => ({ ids: [], error: null })) }));
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false) }));
jest.mock('../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => { req.userId = req.headers['x-test-user']; next(); },
}));

// eslint-disable-next-line import/first
import servicesRouter from '../routes/services.routes';
// eslint-disable-next-line import/first
import { listTournaments } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { getVenue } from '../controllers/venues.controller';
// eslint-disable-next-line import/first
import { listInvites, withdrawInvite } from '../controllers/invites.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const call = async (fn: (req: any, res: any) => unknown, req: Record<string, unknown>) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ headers: {}, query: {}, params: {}, body: {}, userId: ME, ...req }, r);
  return r;
};

describe('1 · tournaments "All": live, upcoming, completed, then cancelled', () => {
  test('the page slices of each status bucket', () => {
    const counts = { live: 2, upcoming: 3, completed: 1, cancelled: 4 };
    expect(bucketSlices(counts, 0, 4)).toEqual([{ status: 'live', from: 0, to: 1 }, { status: 'upcoming', from: 0, to: 2 }]);
    expect(bucketSlices(counts, 3, 6)).toEqual([{ status: 'upcoming', from: 1, to: 2 }, { status: 'completed', from: 0, to: 0 }, { status: 'cancelled', from: 0, to: 0 }]);
    expect(bucketSlices(counts, 5, 99)).toEqual([{ status: 'completed', from: 0, to: 0 }, { status: 'cancelled', from: 0, to: 3 }]);
    expect(bucketSlices({ live: 0, upcoming: 0, completed: 0, cancelled: 0 }, 0, 19)).toEqual([]);
  });
  test('the newest-made cancelled tournament no longer leads the list', async () => {
    const t = (id: string, status: string, created: string, start: string) => ({ id, name: id, status, created_at: created, start_date: start, is_parent: false, parent_id: null, sport_id: 's' });
    db = fakeDb({ tournaments: [
      t('cancelled-newest', 'cancelled', '2026-10-12T10:00:00Z', '2026-10-20'),
      t('completed-1', 'completed', '2026-10-01T10:00:00Z', '2026-10-02'),
      t('upcoming-later', 'upcoming', '2026-10-05T10:00:00Z', '2026-11-30'),
      t('upcoming-soon', 'upcoming', '2026-10-06T10:00:00Z', '2026-10-15'),
      t('live-1', 'live', '2026-09-30T10:00:00Z', '2026-10-10'),
    ] });
    const r = await call(listTournaments, { query: { limit: '20' } });
    expect(r.statusCode).toBe(200);
    expect(r.body.tournaments.map((x: { id: string }) => x.id)).toEqual(['live-1', 'upcoming-soon', 'upcoming-later', 'completed-1', 'cancelled-newest']);
    expect(r.body.total ?? r.body.tournaments.length).toBe(5);
    // A status tab (and Mine) keep their order: newest made first.
    const c = await call(listTournaments, { query: { status: 'completed' } });
    expect(c.body.tournaments.map((x: { id: string }) => x.id)).toEqual(['completed-1']);
  });
});

describe('2 · Services: officials by their sports\' word, counts by city', () => {
  test('the card an official is in', () => {
    expect([...officialCategoriesOf(['football'], ['umpire'])]).toEqual(['referees']); // the bug: was under the cricket umpires
    expect([...officialCategoriesOf(['cricket', 'football'], ['umpire'])].sort()).toEqual(['referees', 'umpires']);
    expect([...officialCategoriesOf(['chess'], ['official'])]).toEqual(['arbiters']);
    expect([...officialCategoriesOf(['hockey', 'badminton'], ['official'])]).toEqual(['umpires']);
    expect([...officialCategoriesOf([], ['umpire'])]).toEqual(['umpires']);
    expect([...officialCategoriesOf([], ['official'])]).toEqual(['referees']);
  });

  const user = (id: string, name: string, city: string, sports: string[]) => ({ id, name, username: name.toLowerCase(), profile_picture_url: null, bio: null, city_id: city, deleted_at: null, is_test_seed: false, city: { name: city }, sports: sports.map((s) => ({ sport: { slug: s, name: s } })) });
  const seed = () => {
    const ravi = user('u-ravi', 'Ravi', 'pune', ['football']); // football referee, picked "Umpire / Referee"
    const asha = user('u-asha', 'Asha', 'pune', ['cricket']);
    const kiran = user('u-kiran', 'Kiran', 'mumbai', ['chess']);
    const both = user('u-both', 'Both', 'mumbai', ['cricket', 'basketball']);
    db = fakeDb({ user_account_types: [
      { user_id: 'u-ravi', account_type: 'umpire', users: ravi },
      { user_id: 'u-asha', account_type: 'umpire', users: asha },
      { user_id: 'u-kiran', account_type: 'official', users: kiran },
      { user_id: 'u-both', account_type: 'umpire', users: both },
      { user_id: 'u-both', account_type: 'official', users: both }, // both types: listed once a card
      { user_id: 'u-coach', account_type: 'coach', users: user('u-coach', 'Coach', 'pune', ['tennis']) },
    ] });
  };
  const server = async () => {
    const app = express();
    app.use('/services', servicesRouter);
    const s = app.listen(0);
    const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    const get = async (p: string) => { const r = await fetch(base + p, { headers: { 'x-test-user': ME } }); return { status: r.status, body: await r.json() as any }; };
    return { get, close: () => s.close() };
  };

  test('each card its own list: Referees holds the football referee; Umpires the cricket ones; Arbiters chess', async () => {
    seed();
    const { get, close } = await server();
    try {
      const names = async (c: string, city = '') => (await get(`/services?category=${c}${city}`)).body.providers.map((p: { name: string }) => p.name).sort();
      expect(await names('referees')).toEqual(['Both', 'Ravi']);
      expect(await names('umpires')).toEqual(['Asha', 'Both']);
      expect(await names('arbiters')).toEqual(['Kiran']);
      expect((await get('/services?category=nope')).status).toBe(400);
      // The old ?type= lists still answer (the released app uses them).
      expect((await get('/services?type=umpire')).body.providers.length).toBe(3);
    } finally { close(); }
  });

  test('counts follow the city (a card\'s number is what its list shows)', async () => {
    seed();
    const { get, close } = await server();
    try {
      const everywhere = (await get('/services/counts')).body;
      expect(everywhere.categories).toEqual({ umpires: 2, referees: 2, arbiters: 1 });
      const pune = (await get('/services/counts?city_id=00000000-0000-4000-8000-000000000001')).body;
      expect(pune.categories).toEqual({ umpires: 0, referees: 0, arbiters: 0 }); // nobody in that city
      // With a city id the rows hold:
      for (const r of db.t('user_account_types')) r.users.city_id = r.users.city_id === 'pune' ? '00000000-0000-4000-8000-000000000001' : r.users.city_id;
      const pune2 = (await get('/services/counts?city_id=00000000-0000-4000-8000-000000000001')).body;
      expect(pune2.categories).toEqual({ umpires: 1, referees: 1, arbiters: 0 });
      expect(pune2.counts.coach).toBe(1);
      const list = (await get('/services?category=referees&city_id=00000000-0000-4000-8000-000000000001')).body;
      expect([list.providers.length, list.total ?? list.providers.length]).toEqual([1, 1]);
    } finally { close(); }
  });
});

const VID = '22222222-2222-4222-8222-222222222222';
describe('3 · a venue\'s own page', () => {
  const venue = (createdBy: string, owner: Record<string, unknown> | null) => ({ id: VID, name: 'Deccan Gymkhana', address: 'Prabhat Road', city_id: 'c', created_by: createdBy, deleted_at: null, sport_id: 's', surface: 'Clay', image_url: null, city: { name: 'Pune' }, sport: { slug: 'tennis', name: 'Tennis' }, owner });
  test('name, address, city, sport — and who added it, to message', async () => {
    db = fakeDb({ venues: [venue('u2', { id: 'u2', name: 'Asha', username: 'asha', profile_picture_url: null, deleted_at: null })], user_blocks: [] });
    const r = await call(getVenue, { params: { id: VID } });
    expect(r.statusCode).toBe(200);
    expect(r.body.venue).toMatchObject({ name: 'Deccan Gymkhana', address: 'Prabhat Road', city: 'Pune', sport_slug: 'tennis', sport_name: 'Tennis', surface: 'Clay', contact: { id: 'u2', name: 'Asha' }, can_edit: false });
  });
  test('your own venue: no "message yourself", and you can edit it; a deleted adder is not offered', async () => {
    db = fakeDb({ venues: [venue(ME, { id: ME, name: 'Me', deleted_at: null })], user_blocks: [] });
    expect((await call(getVenue, { params: { id: VID } })).body.venue).toMatchObject({ contact: null, can_edit: true });
    db = fakeDb({ venues: [venue('u3', { id: 'u3', name: 'Gone', deleted_at: '2026-10-01' })], user_blocks: [] });
    expect((await call(getVenue, { params: { id: VID } })).body.venue.contact).toBeNull();
  });
  test('a deleted or unknown venue is 404', async () => {
    db = fakeDb({ venues: [{ ...venue('u2', null), deleted_at: '2026-10-01' }] });
    expect((await call(getVenue, { params: { id: VID } })).statusCode).toBe(404);
    expect((await call(getVenue, { params: { id: 'not-a-uuid' } })).statusCode).toBe(404);
  });
});

describe('4 · Play invites: Sent, and withdraw keeps the invite as "withdrawn"', () => {
  test('the sender sees it withdrawn; the receiver no longer sees it', async () => {
    const now = new Date().toISOString();
    db = fakeDb({ invites: [
      { id: 'i1', sender_id: ME, receiver_id: 'u-ravi', sport_id: 's', status: 'pending', created_at: now, message: null },
      { id: 'i2', sender_id: ME, receiver_id: 'u-asha', sport_id: 's', status: 'accepted', created_at: now, message: null },
    ] });
    const w = await call(withdrawInvite, { params: { id: 'i1' } });
    expect([w.statusCode, w.body]).toEqual([200, { success: true }]);
    expect(db.t('invites').find((x) => x.id === 'i1')).toMatchObject({ status: 'withdrawn' });
    const sent = await call(listInvites, { query: { box: 'sent' } });
    expect(sent.body.invites.map((x: { id: string; status: string }) => `${x.id}:${x.status}`).sort()).toEqual(['i1:withdrawn', 'i2:accepted']);
    const inbox = await call(listInvites, { userId: 'u-ravi', query: {} });
    expect(inbox.body.invites).toEqual([]);
    // Only a waiting invite can be withdrawn.
    expect((await call(withdrawInvite, { params: { id: 'i2' } })).statusCode).toBe(400);
  });
});
