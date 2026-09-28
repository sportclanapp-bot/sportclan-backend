/**
 * Phase 4 · D1 — MVP bugs from SCALE-QA-BUGS.md fixed in f447ba5 (SC-14, a
 * non-fix commit). Harness copied from f23Mvp.unit.test.ts.
 *  SC-14-tb: a tie was decided by Map iteration order.
 *  SC-15-tt: 'table-tennis' never matched the single-token family checks.
 */
const db: { sport: string; events: any[]; parts: any[]; summary: any } = { sport: 'football', events: [], parts: [], summary: {} };

jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      update: () => chain,
      maybeSingle: async () => ({
        data: table === 'matches' ? { sport_id: 's', winner_team_id: null, score_summary: db.summary } : table === 'sports' ? { slug: db.sport } : null,
      }),
      then: (res: any) => res({ data: table === 'match_events' ? db.events : table === 'match_participants' ? db.parts : [], error: null }),
    };
    return chain;
  };
  return { supabase: { from } };
});
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn() }));

// eslint-disable-next-line import/first
import { calculateAndSetMVP } from '../controllers/matchFeatures.controller';

const goal = (side: 'A' | 'B', player: string) =>
  ({ event_type: 'score', created_by: 'scorer', payload: { team_side: side, kind: 'goal', value: 1, player_id: player } });
const pt = (side: 'A' | 'B', player: string) =>
  ({ event_type: 'score', created_by: 'scorer', payload: { team_side: side, kind: 'point', value: 1, player_id: player } });

beforeEach(() => { db.sport = 'football'; db.events = []; db.parts = []; db.summary = {}; });

describe('SC-14 · MVP tie-break is deterministic', () => {
  test('SC-14-tb (f447ba5): level on goals → the player on the winning side, whichever was seen first', async () => {
    db.summary = { winner_side: 'B' };
    db.parts = [{ user_id: 'a1', team_side: 'A' }, { user_id: 'b1', team_side: 'B' }];
    db.events = [goal('A', 'a1'), goal('A', 'a1'), goal('B', 'b1'), goal('B', 'b1')];
    expect(await calculateAndSetMVP('m')).toBe('b1');
  });

  test('SC-14-tb (f447ba5): level on the same side → the lowest id, not insertion order', async () => {
    db.summary = { winner_side: 'A' };
    db.parts = [{ user_id: 'zed', team_side: 'A' }, { user_id: 'amy', team_side: 'A' }];
    db.events = [goal('A', 'zed'), goal('A', 'amy')];
    expect(await calculateAndSetMVP('m')).toBe('amy');
  });
});

describe('SC-15 · the table-tennis slug', () => {
  test('SC-15-tt (f447ba5): "table-tennis" is the tabletennis family — the MVP comes from the winning side', async () => {
    db.sport = 'table-tennis';
    db.summary = { winner_side: 'A' };
    db.parts = [{ user_id: 'a1', team_side: 'A' }, { user_id: 'b1', team_side: 'B' }];
    db.events = [pt('A', 'a1'), pt('A', 'a1'), pt('B', 'b1'), pt('B', 'b1'), pt('B', 'b1')];
    expect(await calculateAndSetMVP('m')).toBe('a1');
  });
});
