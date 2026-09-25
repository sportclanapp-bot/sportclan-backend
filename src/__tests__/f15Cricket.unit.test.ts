/**
 * F-15 (MATCH_CREATE_TEST_PLAN) · cricket and football details, server side:
 *   own-goal push named the conceding team as scoring;
 *   wicket push always said "Batter out" (read batter_name; the app sends batsman_name);
 *   "won by N wickets" needed a recorded toss;
 *   the DLS target was stored but never decided anything;
 *   maidens were always 0.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
import { aggregateCricketPlayers } from '../controllers/scoring.controller';
import { deriveResultText, dlsWinner, chasingSide } from '../utils/matchResult';
import { scorePush } from '../utils/scorePush';
import { dlsOutcome } from '../utils/cricketRules';

const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('own goal push', () => {
  test('credits the side it counts for, and names who put it in', () => {
    const p = scorePush({ slug: 'football', summary: { A: { score: 1 }, B: { score: 0 } }, side: 'A', teamName: 'Lions', kind: 'own_goal', concedingName: 'Tigers' });
    expect(p).toEqual({ title: 'GOAL!', body: 'Lions scores! 1-0 (own goal by Tigers)' });
  });
  test('createEvent flips the side for an own goal', () => {
    const s = src('controllers/scoring.controller.ts');
    expect(s).toContain("const forSide: 'A' | 'B' = ownGoal ? (side === 'B' ? 'A' : 'B') : side === 'B' ? 'B' : 'A';");
    expect(s).toContain('concedingName: ownGoal ? teamName(side) : undefined,');
  });
});

describe('wicket push', () => {
  test('reads the name the app sends, then the rollup', () => {
    const s = src('controllers/scoring.controller.ts');
    expect(s).toContain("(payload?.batsman_name as string) || (payload?.batter_name as string) ||");
    expect(s).toContain("(line?.name as string) || 'Batter'");
    expect(s).toContain("(typeof line?.runs === 'number' ? line.runs : '')");
  });
});

describe('by wickets without a toss', () => {
  test('the side that did not bat first chased', () => {
    expect(chasingSide(null, null, 'A')).toBe('B');
    expect(chasingSide(null, null, 'B')).toBe('A');
    expect(chasingSide('A', 'bat', 'B')).toBe('B'); // a toss still wins
    expect(chasingSide(null, null, null)).toBeNull();
  });
  test('a chase with no toss reads "by wickets"', () => {
    const r = deriveResultText({ sport: 'cricket', teamAName: 'A', teamBName: 'B', aScore: 50, bScore: 51, bWickets: 3, firstBattingSide: 'A' });
    expect(r.text).toBe('B won by 7 wickets');
  });
  test('recompute stores first_batting_side from the first delivery', () => {
    const s = src('controllers/scoring.controller.ts');
    expect(s).toContain("if (slug === 'cricket') summary.first_batting_side = cricketFirstBat;");
  });
});

describe('DLS', () => {
  test('dlsOutcome', () => {
    expect(dlsOutcome(80, 80)).toEqual({ winner: 'chaser', runs: 0 });
    expect(dlsOutcome(79, 80)).toEqual({ winner: null, runs: 0 });
    expect(dlsOutcome(70, 80)).toEqual({ winner: 'defender', runs: 9 });
    expect(dlsOutcome(70, null)).toBeNull();
    expect(dlsOutcome(70, 0)).toBeNull();
  });
  test('the revised target decides, not the full first innings', () => {
    // A made 120; rain; B's revised target 80, B made 85 → B wins though 85 < 120.
    const base = { sport: 'cricket', teamAName: 'A', teamBName: 'B', aScore: 120, bScore: 85, bWickets: 4, firstBattingSide: 'A' as const, dlsTarget: 80 };
    expect(deriveResultText(base)).toEqual({ text: 'B won by 6 wickets (DLS)', winnerSide: 'B' });
    expect(deriveResultText({ ...base, bScore: 70 })).toEqual({ text: 'A won by 9 runs (DLS)', winnerSide: 'A' });
    expect(deriveResultText({ ...base, bScore: 79 })).toEqual({ text: 'Tied (DLS)', winnerSide: null });
    expect(dlsWinner(base)?.winnerSide).toBe('B');
  });
  test('completion refuses a named winner the DLS target contradicts', () => {
    const m = src('controllers/matches.controller.ts');
    expect(m).toContain("code: 'DLS_WINNER_MISMATCH'");
    expect(m).toContain("dlsTarget: ss?.dls_applied ? Number(ss?.dls_target ?? 0) || null : null,");
  });
});

describe('maidens', () => {
  const ball = (runs: number, bowler = 'bw1', side = 'A', extra: Record<string, unknown> = {}) =>
    ({ event_type: 'ball', payload: { team_side: side, runs, bowler_id: bowler, batsman_id: 'bat1', ...extra } });
  test('six dots from one bowler is a maiden', () => {
    const p = aggregateCricketPlayers([...Array(6)].map(() => ball(0)));
    expect(p.bw1!.bowl_maidens).toBe(1);
  });
  test('a run, a wide or a bowler change spoils it; byes do not', () => {
    expect(aggregateCricketPlayers([ball(1), ...[...Array(5)].map(() => ball(0))]).bw1!.bowl_maidens).toBe(0);
    const wide = { event_type: 'extra', payload: { team_side: 'A', type: 'Wd', runs: 1, bowler_id: 'bw1' } };
    expect(aggregateCricketPlayers([wide, ...[...Array(6)].map(() => ball(0))]).bw1!.bowl_maidens).toBe(0);
    const change = aggregateCricketPlayers([...[...Array(3)].map(() => ball(0)), ...[...Array(3)].map(() => ball(0, 'bw2'))]);
    expect(change.bw1!.bowl_maidens + change.bw2!.bowl_maidens).toBe(0);
    const bye = { event_type: 'extra', payload: { team_side: 'A', type: 'B', runs: 2, bowler_id: 'bw1' } };
    expect(aggregateCricketPlayers([bye, ...[...Array(5)].map(() => ball(0))]).bw1!.bowl_maidens).toBe(1);
  });
  test('a wicket maiden counts; two overs, two maidens', () => {
    const w = { event_type: 'wicket', payload: { team_side: 'A', wicket_type: 'bowled', bowler_id: 'bw1', batsman_id: 'bat1' } };
    expect(aggregateCricketPlayers([w, ...[...Array(11)].map(() => ball(0))]).bw1!.bowl_maidens).toBe(2);
  });
  test('innings_stats writes them', () => {
    expect(src('controllers/scoring.controller.ts')).toContain('bowling_maidens: line.bowl_maidens,');
  });
});
