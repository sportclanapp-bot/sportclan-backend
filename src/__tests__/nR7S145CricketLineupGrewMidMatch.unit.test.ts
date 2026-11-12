/**
 * N-R7-S145 (SIDE-C3b-1, Batch 13 lane C3b) · players added to a cricket line-up
 * mid-match: the stored line-up still said 3 a side, so the summary capped the
 * recorded wickets at 2 (41/2 v 41/2, all out) though the scorecard listed 8 and 6
 * dismissals. The side's line-up is now at least the batters it really used.
 */
const db: { sport: string; events: any[]; lineup: any[]; parts: any[]; summary: any; written: any[] } = {
  sport: 'cricket', events: [], lineup: [], parts: [], summary: {}, written: [],
};
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain, range: () => chain, is: () => chain, limit: () => chain, // audit #38: paged event reads
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
const ev = (event_type: string, payload: object) => ({ event_type, payload, created_by: 'scorer' });
beforeEach(() => { db.sport = 'cricket'; db.events = []; db.lineup = []; db.parts = []; db.summary = {}; db.written = []; });


const bat = (side: 'A' | 'B', n: number) => ev('ball', { team_side: side, runs: 1, batsman_id: `${side}${n}`, non_striker_id: `${side}${n + 1}` });
const out = (side: 'A' | 'B', n: number) => ev('wicket', { team_side: side, wicket_type: 'bowled', batsman_id: `${side}${n}` });

test('wickets past the stored line-up are kept when more batters played', async () => {
  db.lineup = ['A', 'A', 'A', 'B', 'B', 'B'].map((team_side) => ({ team_side }));
  // A: batters A1..A8 (6 out, 2 not out) · B: A side of 3 that is 2 down, ids unknown
  for (let i = 1; i <= 6; i++) db.events.push(bat('A', i), out('A', i));
  db.events.push(bat('A', 7));
  db.events.push(ev('ball', { team_side: 'B', runs: 6 }), ev('wicket', { team_side: 'B', wicket_type: 'bowled' }), ev('wicket', { team_side: 'B', wicket_type: 'caught' }));
  const s = await recomputeSummary('m');
  expect(s!.A).toMatchObject({ wickets: 6, all_out: false, all_out_at: 7 });
  expect(s!.B).toMatchObject({ wickets: 2, all_out: true, all_out_at: 2 });
});

test('the line-up as stored still decides when play shows no more batters', async () => {
  db.lineup = ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B'].map((team_side) => ({ team_side }));
  db.events = [bat('A', 1), out('A', 1)];
  const s = await recomputeSummary('m');
  expect(s!.A).toMatchObject({ wickets: 1, all_out: false, all_out_at: 3 });
});
