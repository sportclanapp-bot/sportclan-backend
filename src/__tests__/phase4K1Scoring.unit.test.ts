/**
 * Phase 4 · K1 — the stored score_summary is rebuilt from the event log for
 * every sport, and Player of the Match reads the keys the rulesets really send.
 * Supabase is mocked per table; the sport comes from a mocked sport cache.
 */
const db: { sport: string; events: any[]; lineup: any[]; parts: any[]; summary: any; written: any[] } = {
  sport: 'cricket', events: [], lineup: [], parts: [], summary: {}, written: [],
};
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain, is: () => chain, limit: () => chain,
      update: (row: unknown) => { db.written.push({ table, row }); return chain; },
      maybeSingle: async () => ({
        data: table === 'matches' ? { sport_id: 's', winner_team_id: null, score_summary: db.summary, format: null }
          : table === 'sports' ? { slug: db.sport } : null,
      }),
      then: (ok: any) => ok({
        data: table === 'match_events' ? db.events : table === 'match_participants' ? db.parts.length ? db.parts : db.lineup : [],
        error: null,
      }),
    };
    return chain;
  };
  return { supabase: { from, rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/sportCache', () => ({
  ...jest.requireActual('../utils/sportCache'),
  getSport: jest.fn(async () => ({ slug: db.sport })),
}));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn() }));

// eslint-disable-next-line import/first
import { recomputeSummary } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { calculateAndSetMVP } from '../controllers/matchFeatures.controller';

const ev = (event_type: string, payload: object) => ({ event_type, payload, created_by: 'scorer' });

beforeEach(() => { db.sport = 'cricket'; db.events = []; db.lineup = []; db.parts = []; db.summary = {}; db.written = []; });

describe('K1-17a (6214c5e) · cricket extras count toward the stored score', () => {
  test('K1-17a (6214c5e): a wide and a no-ball add runs but no legal ball', async () => {
    db.events = [
      ev('ball', { team_side: 'A', runs: 4 }),
      ev('extra', { team_side: 'A', type: 'Wd', runs: 1 }),
      ev('extra', { team_side: 'A', type: 'Nb', runs: 1 }),
      ev('ball', { team_side: 'A', runs: 2 }),
    ];
    const s = await recomputeSummary('m');
    expect(s!.A).toMatchObject({ runs: 8, balls: 2, score: 8 });
    const stored = db.written.find((w) => w.table === 'matches')!.row as any;
    expect(stored.score_summary.A.runs).toBe(8);
  });
});

describe('K1-28a (4241ece, A5-002) · non-cricket scores are rebuilt and stored too', () => {
  test('K1-28a (4241ece): football counts score events with kind goal (own goals to the other side)', async () => {
    db.sport = 'football';
    db.events = [
      ev('score', { team_side: 'A', kind: 'goal' }),
      ev('score', { team_side: 'B', kind: 'goal' }),
      ev('score', { team_side: 'A', kind: 'goal' }),
      ev('score', { team_side: 'B', kind: 'own_goal' }),
      ev('card', { team_side: 'B', kind: 'yellow' }),
    ];
    const s = await recomputeSummary('m');
    expect([s!.A.score, s!.B.score]).toEqual([3, 1]);
    expect([s!.A.goals, s!.B.goals]).toEqual([3, 1]);
    expect(db.written.some((w) => w.table === 'matches')).toBe(true);
  });
  test('K1-28a (4241ece): basketball sums payload.value per side', async () => {
    db.sport = 'basketball';
    db.events = [ev('score', { team_side: 'A', value: 3 }), ev('score', { team_side: 'B', value: 2 }), ev('score', { team_side: 'A', value: 1 })];
    const s = await recomputeSummary('m');
    expect([s!.A.points, s!.B.points]).toEqual([4, 2]);
  });
  test('K1-28a (4241ece): badminton rolls points into games won (21-x takes a game)', async () => {
    db.sport = 'badminton';
    db.events = Array.from({ length: 21 }, () => ev('score', { team_side: 'A', kind: 'point', value: 1 }))
      .concat([ev('score', { team_side: 'B', kind: 'point', value: 1 })]);
    const s = await recomputeSummary('m');
    expect(s!.A.score).toBe(1);
    expect(s!.B.score).toBe(0);
    expect(s!.A.sets).toEqual([21]);
  });
});

describe('K1-30c (48f4849, A5-012) · a side can never have more wickets than it can lose', () => {
  test('K1-30c (48f4849): 12 wicket events with no line-up store 10 wickets, not 12', async () => {
    db.events = Array.from({ length: 12 }, () => ev('wicket', { team_side: 'A', wicket_type: 'bowled' }));
    const s = await recomputeSummary('m');
    expect(s!.A.wickets).toBe(10);
  });
});

describe('K1-28d (4241ece) · Player of the Match reads the keys the rulesets send', () => {
  test('K1-28d (4241ece, A5-005): football goals are score+kind:goal — the scorer of two goals wins it', async () => {
    db.sport = 'football';
    db.summary = { winner_side: 'A' };
    db.parts = [{ user_id: 'a1', team_side: 'A' }, { user_id: 'a2', team_side: 'A' }, { user_id: 'b1', team_side: 'B' }];
    db.events = [
      ev('score', { team_side: 'A', kind: 'goal', player_id: 'a2' }),
      ev('score', { team_side: 'A', kind: 'goal', player_id: 'a2' }),
      ev('assist', { team_side: 'A', player_id: 'a1' }),
    ];
    expect(await calculateAndSetMVP('m')).toBe('a2');
  });
  test('K1-28d (4241ece, A5-006): basketball points come from payload.value', async () => {
    db.sport = 'basketball';
    db.summary = { winner_side: 'B' };
    db.parts = [{ user_id: 'b1', team_side: 'B' }, { user_id: 'b2', team_side: 'B' }, { user_id: 'a1', team_side: 'A' }];
    db.events = [
      ev('score', { team_side: 'B', value: 3, player_id: 'b2' }),
      ev('score', { team_side: 'B', value: 3, player_id: 'b2' }),
      ev('score', { team_side: 'B', value: 1, player_id: 'b1' }),
      ev('assist', { team_side: 'B', player_id: 'b1' }),
    ];
    expect(await calculateAndSetMVP('m')).toBe('b2');
  });
  test('K1-28d (4241ece, A5-008): chess MVP is the player on the WINNING side (B), not the first side-A player', async () => {
    db.sport = 'chess';
    db.summary = { winner_side: 'B' };
    db.parts = [{ user_id: 'white', team_side: 'A' }, { user_id: 'black', team_side: 'B' }];
    db.events = [];
    expect(await calculateAndSetMVP('m')).toBe('black');
  });
});
