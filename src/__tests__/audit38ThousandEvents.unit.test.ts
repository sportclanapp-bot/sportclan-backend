/**
 * Audit #38 (11 Oct 2026): the score rebuild read a match's events with one
 * plain query, which PostgREST answers with at most 1000 rows. Past event 1000
 * nothing counted (seen locally: a football goal after 1100 notes left 1–0).
 * The fake database here answers at most 1000 rows a request, like PostgREST.
 */
import { fakeDb } from './helpers/fakeSupabase';

const M = 'mmmmmmmm-mmmm-4mmm-8mmm-000000000001';
const sports = [{ id: 's-fb', slug: 'football' }, { id: 's-bb', slug: 'basketball' }, { id: 's-cr', slug: 'cricket' }];
let n = 0;
const ev = (event_type: string, payload: object) => ({ id: `e${String(++n).padStart(8, '0')}`, match_id: M, event_type, payload, created_at: new Date(Date.UTC(2026, 9, 11, 0, 0, 0, n)).toISOString(), clock_seconds: null, period: null });
let db = fakeDb({}, { maxRows: 1000 });
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));

// eslint-disable-next-line import/first
import { recomputeSummary } from '../controllers/scoring.controller';

function seed(sportId: string, events: object[]) {
  db = fakeDb({ sports, matches: [{ id: M, sport_id: sportId, score_summary: {}, format: null, overs: 20, rules: {} }], match_events: events as any[] }, { maxRows: 1000 });
}
const notes = (k: number) => Array.from({ length: k }, () => ev('note', { kind: 'clock_pause' }));

describe('audit #38: the score keeps counting past 1000 events', () => {
  it('football: a goal after 1100 other events still counts', async () => {
    seed('s-fb', [ev('score', { kind: 'goal', value: 1, team_side: 'A' }), ...notes(1100), ev('score', { kind: 'goal', value: 1, team_side: 'B' })]);
    const s = await recomputeSummary(M, { persist: false });
    expect(s?.A?.score).toBe(1);
    expect(s?.B?.score).toBe(1);
  });

  it('basketball: 1500 baskets all count', async () => {
    seed('s-bb', Array.from({ length: 1500 }, (_, i) => ev('score', { kind: '2pt', value: 2, team_side: i % 2 ? 'B' : 'A' })));
    const s = await recomputeSummary(M, { persist: false });
    expect(s?.A?.score).toBe(1500);
    expect(s?.B?.score).toBe(1500);
  });

  it('cricket: 1200 balls of 1 run all count', async () => {
    seed('s-cr', Array.from({ length: 1200 }, () => ev('ball', { runs: 1, team_side: 'A', batsman_id: 'b1', bowler_id: 'w1' })));
    const s = await recomputeSummary(M, { persist: false });
    const runs = s?.A?.runs ?? s?.A?.score ?? s?.innings?.[0]?.runs;
    expect(runs).toBe(1200);
  });
});
