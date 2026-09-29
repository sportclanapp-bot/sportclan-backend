/**
 * BUILD 1.3 · NRR charges a side bowled out at ITS all-out count the full
 * quota. The summary now records all_out (line-up − 1, capped at 10), and
 * standings read it instead of assuming 10 wickets.
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
import { inningsOf, computeStats } from '../utils/standings';
const ev = (event_type: string, payload: object) => ({ event_type, payload, created_by: 'scorer' });
beforeEach(() => { db.sport = 'cricket'; db.events = []; db.lineup = []; db.parts = []; db.summary = {}; db.written = []; });

describe('the summary records all out at the side\'s own count', () => {
  test('3-a-side: two wickets is all out; one is not', async () => {
    db.lineup = ['A', 'A', 'A', 'B', 'B', 'B'].map((team_side) => ({ team_side }));
    db.events = [
      ev('ball', { team_side: 'A', runs: 4 }),
      ev('wicket', { team_side: 'A', wicket_type: 'bowled' }),
      ev('wicket', { team_side: 'A', wicket_type: 'caught' }),
      ev('ball', { team_side: 'B', runs: 6 }),
      ev('wicket', { team_side: 'B', wicket_type: 'bowled' }),
    ];
    const s = await recomputeSummary('m');
    expect(s!.A).toMatchObject({ wickets: 2, all_out: true });
    expect((s!.B as any).all_out).toBeUndefined();
  });
});

describe('NRR: an all-out side is charged its full overs', () => {
  const m = (A: object, B: object) => ({ team_a_id: 'a', team_b_id: 'b', winner_team_id: 'b', status: 'completed', overs: 6, score_summary: { A, B } });
  test('a 6-a-side side all out for 5 wickets in 3 overs is charged all 6', () => {
    const inn = inningsOf(m({ runs: 30, wickets: 5, balls: 18, all_out: true }, { runs: 31, wickets: 1, balls: 20 }));
    expect(inn.a.overs).toBe(6);
    expect(inn.b.overs).toBeCloseTo(20 / 6);
  });
  test('without the flag, 10 wickets still counts as all out (older summaries)', () => {
    expect(inningsOf(m({ runs: 30, wickets: 10, balls: 18 }, { runs: 31, wickets: 1, balls: 20 })).a.overs).toBe(6);
  });
  test('NRR moves accordingly', () => {
    const st = computeStats(['a', 'b'], [m({ runs: 30, wickets: 5, balls: 18, all_out: true }, { runs: 31, wickets: 1, balls: 20 }) as any]);
    expect(st.get('a')!.nrr).toBeCloseTo(30 / 6 - 31 / (20 / 6), 3);
  });
});
