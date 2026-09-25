/**
 * F-23 (MATCH_CREATE_TEST_PLAN): the MVP fell back to the scorer. A point with
 * the player picker skipped was credited to created_by whenever the scorer was
 * in the line-up. Now: the named player; else the only player on the side that
 * won the point (singles); else nobody.
 */
const db: { sport: string; events: any[]; parts: any[]; summary: any; written: any } = { sport: 'badminton', events: [], parts: [], summary: {}, written: null };

jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      update: (row: unknown) => { db.written = row; return chain; },
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

import { calculateAndSetMVP } from '../controllers/matchFeatures.controller';

const pt = (side: 'A' | 'B', by: string, player?: string) =>
  ({ event_type: 'score', created_by: by, payload: { team_side: side, kind: 'point', value: 1, ...(player ? { player_id: player } : {}) } });

beforeEach(() => { db.sport = 'badminton'; db.events = []; db.parts = []; db.summary = { winner_side: 'B' }; db.written = null; });

test('singles: unattributed points go to the side\'s only player, not the scorer', async () => {
  db.parts = [{ user_id: 'scorerA', team_side: 'A' }, { user_id: 'oppB', team_side: 'B' }];
  // A scores every rally; B wins 3, A wins 1 — B must be MVP, not the scorer.
  db.events = [pt('B', 'scorerA'), pt('B', 'scorerA'), pt('B', 'scorerA'), pt('A', 'scorerA')];
  expect(await calculateAndSetMVP('m')).toBe('oppB');
});

test('doubles: an unattributed point credits nobody — the scorer never collects it', async () => {
  db.parts = [{ user_id: 'scorerA', team_side: 'A' }, { user_id: 'a2', team_side: 'A' }, { user_id: 'b1', team_side: 'B' }, { user_id: 'b2', team_side: 'B' }];
  db.events = [pt('A', 'scorerA'), pt('A', 'scorerA'), pt('A', 'scorerA')];
  expect(await calculateAndSetMVP('m')).toBeNull();
});

test('a named player is credited, whoever scored it', async () => {
  db.summary = { winner_side: 'A' }; // F-36: the credited player's side won
  db.parts = [{ user_id: 'scorerA', team_side: 'A' }, { user_id: 'a2', team_side: 'A' }, { user_id: 'b1', team_side: 'B' }];
  db.events = [pt('A', 'scorerA', 'a2'), pt('A', 'scorerA', 'a2')];
  expect(await calculateAndSetMVP('m')).toBe('a2');
});

test('football: an unattributed goal with a full squad credits nobody', async () => {
  db.sport = 'football';
  db.parts = [{ user_id: 'scorerA', team_side: 'A' }, { user_id: 'a2', team_side: 'A' }];
  db.events = [{ event_type: 'score', created_by: 'scorerA', payload: { team_side: 'A', kind: 'goal', value: 1 } }];
  expect(await calculateAndSetMVP('m')).toBeNull();
});

describe('F-36 · game-and-set sports: Player of the Match is on the winning side', () => {
  // Session 4, R8: A won pickleball 2-1 (11-8, 5-11, 11-9) but B won more points
  // (28 to 27) and was named Player of the Match. Decision 2026-09-25.
  const r8 = () => [...Array(27)].map(() => pt('A', 'scorerA')).concat([...Array(28)].map(() => pt('B', 'scorerA')));
  test.each(['badminton', 'tabletennis', 'pickleball', 'volleyball', 'tennis', 'carrom'])('%s: the winner, even with fewer points', async (sport) => {
    db.sport = sport;
    db.summary = { winner_side: 'A' };
    db.parts = [{ user_id: 'scorerA', team_side: 'A' }, { user_id: 'oppB', team_side: 'B' }];
    db.events = r8();
    expect(await calculateAndSetMVP('m')).toBe('scorerA');
  });
  test('doubles: the winning side\'s top scorer, not the other side\'s', async () => {
    db.sport = 'volleyball';
    db.summary = { winner_side: 'A' };
    db.parts = [{ user_id: 'a1', team_side: 'A' }, { user_id: 'a2', team_side: 'A' }, { user_id: 'b1', team_side: 'B' }, { user_id: 'b2', team_side: 'B' }];
    db.events = [pt('B', 'a1', 'b1'), pt('B', 'a1', 'b1'), pt('B', 'a1', 'b1'), pt('A', 'a1', 'a2'), pt('A', 'a1', 'a2'), pt('A', 'a1', 'a1')];
    expect(await calculateAndSetMVP('m')).toBe('a2');
  });
  test('the winning side credited nothing: no Player of the Match rather than the loser', async () => {
    db.sport = 'tennis';
    db.summary = { winner_side: 'A' };
    db.parts = [{ user_id: 'a1', team_side: 'A' }, { user_id: 'a2', team_side: 'A' }, { user_id: 'b1', team_side: 'B' }];
    db.events = [pt('A', 'a1'), pt('B', 'a1', 'b1')];
    expect(await calculateAndSetMVP('m')).toBeNull();
  });
  test('football keeps its rule (top scorer from either side)', async () => {
    db.sport = 'football';
    db.summary = { winner_side: 'A' };
    db.parts = [{ user_id: 'a1', team_side: 'A' }, { user_id: 'b1', team_side: 'B' }, { user_id: 'b2', team_side: 'B' }];
    const goal = (side: 'A' | 'B', player: string) => ({ event_type: 'score', created_by: 'a1', payload: { team_side: side, kind: 'goal', value: 1, player_id: player } });
    db.events = [goal('B', 'b1'), goal('B', 'b1'), goal('A', 'a1')];
    expect(await calculateAndSetMVP('m')).toBe('b1');
  });
});
