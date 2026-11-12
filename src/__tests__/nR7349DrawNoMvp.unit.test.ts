/**
 * N-R7-349 (Step 2 B13, SIDE-C2b-1): a 9–9 level timed pickleball match named a Player of
 * the Match although neither side won. A drawn game-and-set match names nobody now (as a
 * drawn chess game); a won one and a drawn football match are unchanged.
 */
const db: { sport: string; events: any[]; parts: any[]; summary: any; winner: string | null; written: any } = { sport: 'pickleball', events: [], parts: [], summary: {}, winner: null, written: null };

jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain, eq: () => chain, order: () => chain, range: () => chain,
      update: (row: unknown) => { db.written = row; return chain; },
      maybeSingle: async () => ({
        data: table === 'matches' ? { sport_id: 's', winner_team_id: db.winner, score_summary: db.summary } : table === 'sports' ? { slug: db.sport } : null,
      }),
      then: (res: any) => res({ data: table === 'match_events' ? db.events : table === 'match_participants' ? db.parts : [], error: null }),
    };
    return chain;
  };
  return { supabase: { from } };
});
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn() }));

import { calculateAndSetMVP } from '../controllers/matchFeatures.controller';

const pt = (side: 'A' | 'B', n: number) => Array.from({ length: n }, () => ({ event_type: 'score', created_by: 'x', payload: { team_side: side, kind: 'point', value: 1 } }));

beforeEach(() => {
  db.parts = [{ user_id: 'pA', team_side: 'A' }, { user_id: 'pB', team_side: 'B' }];
  db.events = [...pt('A', 9), ...pt('B', 9)]; db.winner = null; db.written = null; db.sport = 'pickleball';
});

test('pickleball 9–9 timed draw: no Player of the Match', async () => {
  db.summary = { winner_side: null, result: 'Draw', timed_level: true };
  expect(await calculateAndSetMVP('m')).toBeNull();
  expect(db.written.score_summary.mvp).toBeNull();
});

test('control: a won pickleball match still names its winner', async () => {
  db.summary = { winner_side: 'B' }; db.events = [...pt('A', 9), ...pt('B', 11)];
  expect(await calculateAndSetMVP('m')).toBe('pB');
});

test('control: a drawn football match still names its top scorer', async () => {
  db.sport = 'football'; db.summary = { winner_side: null, result: 'Draw' };
  db.events = [{ event_type: 'score', created_by: 'x', payload: { team_side: 'A', kind: 'goal', player_id: 'pA' } }];
  expect(await calculateAndSetMVP('m')).toBe('pA');
});
