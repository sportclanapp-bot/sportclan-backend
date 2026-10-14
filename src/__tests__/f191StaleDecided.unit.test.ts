/**
 * F191 (launch test plan, Round 2): a casual match left LIVE for 6 hours was marked 'abandoned'
 * even when its pad already showed a winner — the result was lost (and a tournament fixture in the
 * same state stayed LIVE). A stale match that its own rules say is decided is now ENDED with that
 * result (completed as its creator would, every rating and bracket step included); an undecided
 * casual one is abandoned as before; an undecided tournament fixture is still left to its organiser.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockRows: unknown[] = [];
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`]; mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'eq', 'is', 'lt', 'update', 'order', 'limit']) chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: q.some((c) => c.startsWith('update:')) ? [{ id: 'x' }] : mockRows, error: null }));
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn() } };
});
// eslint-disable-next-line import/first
import { staleMatchOutcome, sweepStaleLiveMatches } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

describe('what a stale match’s own rules say', () => {
  test('a best-of match a side has won (badminton 2–0 in games)', () => {
    expect(staleMatchOutcome('badminton', { A: { score: 2 }, B: { score: 0 } }, { rules: { ...standardRules('badminton'), bestOf: 3 } }, [])).toEqual({ side: 'A' });
  });
  test('a chess game with its result', () => {
    expect(staleMatchOutcome('chess', { chess: { result: 'Black wins' } }, { rules: standardRules('chess') }, [])).toEqual({ side: 'B' });
    expect(staleMatchOutcome('chess', { chess: { result: 'Draw' } }, { rules: standardRules('chess') }, [])).toEqual({ side: null });
  });
  test('a cricket chase that is over (and one that isn’t)', () => {
    const rules = { ...standardRules('cricket'), overs: 1, players: 11 };
    const done = { first_batting_side: 'A', A: { runs: 12, balls: 6, wickets: 0 }, B: { runs: 13, balls: 4, wickets: 1 } };
    expect(staleMatchOutcome('cricket', done, { rules, toss_choice: null }, [])).toEqual({ side: 'B' });
    expect(staleMatchOutcome('cricket', { ...done, B: { runs: 5, balls: 3, wickets: 1 } }, { rules, toss_choice: null }, [])).toBeNull();
  });
  test('a series or team tie it has settled; a game still level is not decided', () => {
    expect(staleMatchOutcome('table-tennis', { tie: { decided: 'B' } }, { rules: standardRules('table-tennis') }, [])).toEqual({ side: 'B' });
    expect(staleMatchOutcome('badminton', { A: { score: 1 }, B: { score: 1 } }, { rules: { ...standardRules('badminton'), bestOf: 3 } }, [])).toBeNull();
    expect(staleMatchOutcome('football', { A: { score: 2 }, B: { score: 1 } }, { rules: standardRules('football') }, [])).toBeNull(); // a timed game: nobody can say it's over
  });
});

test('the sweep ends the decided ones, abandons the undecided casual ones', async () => {
  mockLog = [];
  mockRows = [{ id: 'm1', tournament_id: null }, { id: 'm2', tournament_id: null }, { id: 'm3', tournament_id: 'T' }];
  const ended: string[] = [];
  const out = await sweepStaleLiveMatches({
    outcome: async (id: string) => (id === 'm1' || id === 'm3' ? { side: 'A' as const } : null),
    complete: async (id: string) => { ended.push(id); return true; },
  });
  expect(ended).toEqual(['m1', 'm3']); // a decided tournament fixture is ended too (its bracket moves on)
  const abandoned = mockLog.filter((q) => q.some((c) => c.startsWith('update:'))).flatMap((q) => q.filter((c) => c.startsWith('in:')));
  expect(abandoned.join()).toContain('m2');
  expect(abandoned.join()).not.toMatch(/m1|m3/);
  expect(out).toEqual({ abandoned: 1, completed: 2 });
});
