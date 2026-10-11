/**
 * Audit #12 (11 Oct 2026): kudos paid coins per (sender, receiver, match), so a
 * second account and a stream of self-made matches farmed coins. Now: only on
 * a finished match, only between players who agreed to play it, and coins at
 * most once a week per sender → receiver.
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
const m = (id: string, status = 'completed') => ({ id, status, voided_at: null, created_by: MAIN, tournament_id: null, team_a_id: null, team_b_id: null });
const parts = (mid: string) => [{ match_id: mid, user_id: MAIN, team_side: 'A' }, { match_id: mid, user_id: ALT, team_side: 'B' }];
const call = async (body: object, userId = ALT) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await sendKudos({ userId, body } as any, r);
  return r;
};

describe('audit #12: no kudos coin farming', () => {
  beforeEach(() => {
    coins.length = 0;
    db = fakeDb({
      matches: [m('m1'), m('m2'), m('m3'), m('live', 'live')],
      match_participants: [...parts('m1'), ...parts('m2'), ...parts('m3'), ...parts('live')],
      match_availability: ['m1', 'm2', 'm3', 'live'].map((mid) => ({ match_id: mid, user_id: ALT, status: 'available' })),
      kudos: [], users: [{ id: ALT, name: 'Alt' }],
    });
  });

  it('three matches from an alt in a row pay coins once', async () => {
    for (const mid of ['m1', 'm2', 'm3']) expect((await call({ toUserId: MAIN, matchId: mid })).statusCode).toBe(200);
    expect(coins).toHaveLength(1);
    expect(db.t('kudos')).toHaveLength(3); // the kudos themselves still count
  });

  it('not on a match that isn’t finished', async () => {
    const r = await call({ toUserId: MAIN, matchId: 'live' });
    expect(r.body.code).toBe('MATCH_NOT_FINISHED');
    expect(coins).toHaveLength(0);
  });

  it('not to a player who never agreed to play', async () => {
    db.t('match_availability').length = 0; // the alt never said "In"
    const r = await call({ toUserId: ALT, matchId: 'm1' }, MAIN);
    expect(r.body.code).toBe('NOT_CONFIRMED_PLAYERS');
  });
});
