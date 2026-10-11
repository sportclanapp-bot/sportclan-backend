/**
 * Audit #48 (11 Oct 2026): runs completed before a run-out were lost — the
 * total, the batter and the bowler. They count now; only a run-out's runs count.
 */
import { fakeDb } from './helpers/fakeSupabase';
import { wicketRuns, sideTotals } from '../utils/cricketRules';

const M = 'mmmmmmmm-mmmm-4mmm-8mmm-000000000048';
let n = 0;
const ev = (event_type: string, payload: object) => ({ id: `e${String(++n).padStart(8, '0')}`, match_id: M, event_type, payload, created_at: new Date(Date.UTC(2026, 9, 11, 0, 0, 0, n)).toISOString(), clock_seconds: null, period: null });
let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { recomputeSummary, validateScoringEvent } from '../controllers/scoring.controller';

describe('audit #48: a run-out’s completed runs count', () => {
  it('the rule: only a run-out carries runs', () => {
    expect(wicketRuns({ wicket_type: 'run_out', runs: 2 })).toBe(2);
    expect(wicketRuns({ wicket_type: 'caught', runs: 2 })).toBe(0);
    expect(sideTotals([{ event_type: 'ball', payload: { team_side: 'A', runs: 4 } }, { event_type: 'wicket', payload: { team_side: 'A', wicket_type: 'run_out', runs: 1 } }] as never, 'A', 10)).toMatchObject({ runs: 5, wickets: 1, balls: 2 });
  });
  it('the score: 4, then run out going for the second (1 completed) → 5/1; the batter has 5, the bowler is charged 5', async () => {
    db = fakeDb({
      sports: [{ id: 's-cr', slug: 'cricket' }],
      matches: [{ id: M, sport_id: 's-cr', score_summary: {}, format: null, overs: 20, rules: {} }],
      match_events: [
        ev('ball', { runs: 4, team_side: 'A', batsman_id: 'b1', bowler_id: 'w1' }),
        ev('wicket', { wicket_type: 'run_out', runs: 1, team_side: 'A', batsman_id: 'b1', bowler_id: 'w1', fielder_id: 'f1' }),
      ],
    });
    const s = await recomputeSummary(M, { persist: false });
    expect([s?.A?.runs, s?.A?.wickets]).toEqual([5, 1]);
    const p = (s as any).players;
    expect([p.b1.runs, p.b1.out]).toEqual([5, true]);
    expect([p.w1.bowl_runs, p.w1.bowl_wickets]).toEqual([5, 0]); // a run-out isn't the bowler's wicket
  });
  it('a run-out’s runs must be a whole number, 0 or more', async () => {
    const r = await validateScoringEvent(M, { id: M, status: 'live', sport_id: 's-cr' }, { event_type: 'wicket', payload: { wicket_type: 'run_out', runs: -1, team_side: 'A' } });
    expect(r?.body.code).toBe('BAD_WICKET_RUNS');
  });
});
