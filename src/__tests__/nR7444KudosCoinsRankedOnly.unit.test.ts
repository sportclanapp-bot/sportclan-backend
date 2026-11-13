/**
 * N-R7-444 (Step 2 Batch 14, SIDE-B19-1, X2-S12): kudos on a finished FRIENDLY (unranked)
 * match between two accounts of one person paid 2 coins. Kudos coins are ranked-only now,
 * like win coins (SC-283); the kudos itself still counts.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
const coins: string[] = [];
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/coins', () => ({ awardCoins: jest.fn(async (u: string, k: string) => { coins.push(`${u}:${k}`); }) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined) }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), isBlockedBetween: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import { sendKudos } from '../controllers/kudos.controller';

const MAIN = 'u-main'; const ALT = 'u-alt';
const m = (id: string, status = 'completed', is_ranked = true) => ({ id, status, voided_at: null, created_by: MAIN, tournament_id: null, team_a_id: null, team_b_id: null, is_ranked });
const parts = (mid: string) => [{ match_id: mid, user_id: MAIN, team_side: 'A' }, { match_id: mid, user_id: ALT, team_side: 'B' }];
const call = async (body: object, userId = ALT) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await sendKudos({ userId, body } as any, r);
  return r;
};

describe('N-R7-444: kudos coins only on a ranked match', () => {
  beforeEach(() => {
    coins.length = 0;
    db = fakeDb({
      matches: [m('casual', 'completed', false), m('ranked')],
      match_participants: [...parts('casual'), ...parts('ranked')],
      match_availability: ['casual', 'ranked'].map((mid) => ({ match_id: mid, user_id: ALT, status: 'available' })),
      kudos: [], users: [{ id: ALT, name: 'Alt' }],
    });
  });

  it('a friendly: the kudos counts, no coins', async () => {
    const r = await call({ toUserId: MAIN, matchId: 'casual' });
    expect(r.statusCode).toBe(200);
    expect(r.body.coins).toBe(0);
    expect(coins).toHaveLength(0);
    expect(db.t('kudos')).toHaveLength(1);
  });

  it('a ranked match still pays', async () => {
    const r = await call({ toUserId: MAIN, matchId: 'ranked' });
    expect(r.body.coins).toBe(2);
    expect(coins).toEqual([`${MAIN}:kudos_${db.t('kudos')[0].id}`]);
  });
});
