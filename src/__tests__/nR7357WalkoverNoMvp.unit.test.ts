/**
 * N-R7-357 (Step 2 B13, SIDE-C3c-2): a chess league game decided by walkover (a no-show,
 * nothing played) named a Player of the Match. A walkover names nobody now, in every sport;
 * a played chess win still names its winner.
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

test('chess walkover: no Player of the Match', async () => {
  db.sport = 'chess'; db.events = []; db.winner = 'tA'; db.summary = { winner_side: 'A', walkover: true, result: 'White wins' };
  expect(await calculateAndSetMVP('m')).toBeNull();
  expect(db.written.score_summary.mvp).toBeNull();
});

test('pickleball walkover: none either', async () => {
  db.summary = { winner_side: 'A', walkover: true }; db.events = [];
  expect(await calculateAndSetMVP('m')).toBeNull();
});

test('control: a won pickleball match still names its winner', async () => {
  db.summary = { winner_side: 'B' }; db.events = [...pt('A', 9), ...pt('B', 11)];
  expect(await calculateAndSetMVP('m')).toBe('pB');
});
