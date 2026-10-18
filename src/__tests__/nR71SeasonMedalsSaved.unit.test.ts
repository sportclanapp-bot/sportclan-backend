/**
 * Step 2 (Round 7) · N-R7-1: ending a season never saved a medal. season_medals.final_rating and final_rank
 * are NOT NULL (migration 078, copied from live) and the insert sent neither; its error was ignored, the
 * season closed anyway and the answer said 'medalsAwarded: 33'. Found running case AT-E054 on the local stack.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(), notifyUser: jest.fn() }));
jest.mock('../utils/testContent', () => ({ testFlagReady: jest.fn(async () => true), hideTestFor: jest.fn(async () => true) }));
// eslint-disable-next-line import/first
import { endSeason } from '../controllers/seasons.controller';

const season = { id: 'season-1', name: 'Season 1', season_number: 1, is_active: true };
let medalError: unknown = null;
beforeEach(() => {
  process.env.ADMIN_KEY = 'k'; mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:seasons' && q.some((c) => c.startsWith('maybeSingle'))) return { data: season };
    if (q[0] === 'from:sports') return { data: [{ id: 'cricket', name: 'Cricket' }] };
    if (q[0] === 'from:user_sport_profiles') return { data: [{ user_id: 'u1', rating: 1532.6 }, { user_id: 'u2', rating: 1490 }] };
    if (q[0] === 'from:season_medals') return { error: medalError };
    return { data: null };
  };
});
const end = async () => { const r = res(); await endSeason({ headers: { 'x-admin-key': 'k' } } as any, r); return r; };
const seasonClosed = () => mock.log.some((q) => q[0] === 'from:seasons' && q.some((c) => c.startsWith('update')));

test('each medal is saved with its final rating and rank (both required)', async () => {
  medalError = null;
  const r = await end();
  expect(r.statusCode).toBe(200);
  const ins = mock.log.find((q) => q[0] === 'from:season_medals')!.join();
  expect(ins).toContain('"user_id":"u1","season_id":"season-1","sport_id":"cricket","medal_type":"gold","final_rating":1533,"final_rank":1');
  expect(ins).toContain('"user_id":"u2","season_id":"season-1","sport_id":"cricket","medal_type":"silver","final_rating":1490,"final_rank":2');
  expect(seasonClosed()).toBe(true);
});
test('a failed save leaves the season open and says so (500 MEDALS_NOT_SAVED)', async () => {
  medalError = { message: 'null value in column "final_rating"' };
  const r = await end();
  expect(r.statusCode).toBe(500);
  expect(r.body.code).toBe('MEDALS_NOT_SAVED');
  expect(seasonClosed()).toBe(false);
});
