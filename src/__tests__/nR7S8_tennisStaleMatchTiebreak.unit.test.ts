/**
 * Step 2 · Batch 5 (Job B): the stored score kept "match_tiebreak: true" after the
 * scorer undid back out of the match tiebreak (sets 1-1 → back to 1-0 in set 2),
 * so the hub card still said "Match tiebreak" over set 2's game. The flag follows
 * the score now: set when the match tiebreak is in play, gone otherwise.
 */
import { fakeDb } from './helpers/fakeSupabase';

const M = 'mmmmmmmm-mmmm-4mmm-8mmm-0000000b5s01';
let n = 0;
const pt = (side: 'A' | 'B') => ({ id: `e${String(++n).padStart(8, '0')}`, match_id: M, event_type: 'score', payload: { team_side: side, kind: 'point', value: 1 }, created_at: new Date(Date.UTC(2026, 9, 25, 0, 0, 0, n)).toISOString(), clock_seconds: null, period: null });
const game = (side: 'A' | 'B') => [pt(side), pt(side), pt(side), pt(side)];
const games = (a: number, b: number) => { const out: ReturnType<typeof pt>[] = []; const lo = Math.min(a, b); for (let i = 0; i < lo; i++) out.push(...game('A'), ...game('B')); for (let i = lo; i < a; i++) out.push(...game('A')); for (let i = lo; i < b; i++) out.push(...game('B')); return out; };
let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { recomputeSummary } from '../controllers/scoring.controller';

const setup = (events: ReturnType<typeof pt>[], stored: object) => fakeDb({
  sports: [{ id: 's-tn', slug: 'tennis' }],
  matches: [{ id: M, sport_id: 's-tn', score_summary: stored, format: null, overs: null, rules: { v: 1, matchTiebreak: true } }],
  match_events: events,
});

describe('tennis: the match tiebreak flag follows the score', () => {
  it('in the match tiebreak (sets 1-1) the flag is set', async () => {
    db = setup([...games(6, 4), ...games(4, 6), pt('B'), pt('B')], {});
    const s = await recomputeSummary(M, { persist: false }) as Record<string, unknown>;
    expect(s.match_tiebreak).toBe(true);
  });
  it('undone back into set 2 (sets 1-0, games 5-6), the stored flag goes', async () => {
    db = setup([...games(6, 4), ...games(5, 5), ...game('B'), pt('B'), pt('B')], { match_tiebreak: true, tiebreak: true });
    const s = await recomputeSummary(M, { persist: false }) as Record<string, any>;
    expect([s.A.score, s.B.score, s.A.games, s.B.games]).toEqual([1, 0, 5, 6]);
    expect(s.tiebreak).toBe(false);
    expect(s.match_tiebreak).toBeUndefined();
  });
});
