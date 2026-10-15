/** F060 (launch test plan): "My city" rankings for someone with no city said "No ranked players yet" — the answer didn't say why it was empty. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => 'sport-1') }));
jest.mock('../utils/sports', () => ({ isSportInactive: jest.fn(async () => false), activeSportIds: jest.fn(async () => null) }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q }));
// eslint-disable-next-line import/first
import { getLeaderboard } from '../controllers/leaderboard.controller';

const call = async (query: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getLeaderboard({ userId: 'me', query: { sport_id: 'cricket', ...query } } as any, r);
  return r;
};

test('no city set: an empty list that says a city is needed', async () => {
  db = fakeDb({ users: [{ id: 'me', city_id: null }] });
  const r = await call({ scope: 'city' });
  expect(r.statusCode).toBe(200);
  expect(r.body).toMatchObject({ leaderboard: [], me: null, needs_city: true });
});

test('with a city, no flag', async () => {
  db = fakeDb({ users: [{ id: 'me', city_id: 'c1' }], user_sport_profiles: [] });
  const r = await call({ scope: 'city' });
  expect(r.body.needs_city).toBeUndefined();
});
