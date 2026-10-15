/**
 * N-RWG4-15 (launch test plan, Round 4) · Home's "Most active this week" was one list
 * cached for 24 hours for everyone: a player you blocked kept showing there, and an
 * account deleted today stayed up to a day (a tap opened 'This player doesn't exist').
 * The cache holds the candidates; every read drops the viewer's blocks and accounts
 * deleted since, and the next player in that sport takes the card.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => true), excludeTest: jest.fn((q: unknown) => q),
  excludeTestEmbed: jest.fn((q: unknown) => q), testUserIdSet: jest.fn(async () => new Set()),
}));
// eslint-disable-next-line import/first
import { getPlayerOfWeek } from '../controllers/features.controller';

const read = async (viewer: string) => {
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getPlayerOfWeek({ userId: viewer, params: {}, query: {}, body: {} } as never, r);
  return (r.body.players as Array<{ user: { id: string }; sport_id: string }>).map((p) => `${p.user.id}:${p.sport_id}`);
};

test('a block, or an account deleted today, shows at once — not a day later', async () => {
  const now = new Date().toISOString();
  db = fakeDb({
    user_sport_profiles: [
      { user_id: 'f', sport_id: 'cricket', rating: 1500, wins: 9, matches_played: 10, last_match_at: now },
      { user_id: 'h', sport_id: 'cricket', rating: 1300, wins: 3, matches_played: 5, last_match_at: now },
      { user_id: 'g', sport_id: 'chess', rating: 1400, wins: 5, matches_played: 6, last_match_at: now },
    ],
    match_participants: ['f', 'h', 'g'].map((u) => ({ user_id: u, match: { sport_id: u === 'g' ? 'chess' : 'cricket', status: 'completed', voided_at: null, completed_at: now } })),
    users: ['f', 'g', 'h', 'k', 'z'].map((id) => ({ id, name: id.toUpperCase(), username: id, profile_picture_url: null, deleted_at: null })),
  });
  expect(await read('k')).toEqual(['f:cricket', 'g:chess']); // builds the cache

  db.tables.user_blocks = [{ blocker_id: 'k', blocked_id: 'f' }]; // K blocks F
  expect(await read('k')).toEqual(['g:chess', 'h:cricket']); // the next cricket player takes the card (ordered by score)
  expect(await read('z')).toEqual(['f:cricket', 'g:chess']); // nobody else is affected

  db.tables.users.find((u: any) => u.id === 'g')!.deleted_at = now; // G deletes their account today
  expect(await read('z')).toEqual(['f:cricket']);
});
