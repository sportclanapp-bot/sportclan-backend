/**
 * Stage 15 · basketball (Oct 2026), the server's side: the box score and its
 * boards, a series read game by game, typed periods and series, the 3x3 table
 * order, and the foul kinds / overtime team-foul fix in the shared rules.
 */
import { aggregatePlayers, rollupTieSpec } from '../controllers/scoring.controller';
import { sportBoards } from '../utils/sportLeaders';
import { standardRules, BASKETBALL_3X3, rulesRefusal, type MatchRules } from '../utils/matchRules';
import { seriesSpec } from '../utils/tieCore';
import { typedPeriodPoints, typedSeriesPoints } from '../utils/typedScore';
import { foulTally } from '../utils/basketballRules';
import { computeStats } from '../utils/standings';

const sideOf = (p: any): 'A' | 'B' => (p?.team_side === 'B' ? 'B' : 'A');
const shot = (id: string, v: number, side: 'A' | 'B' = 'A') => ({ event_type: 'score', payload: { team_side: side, player_id: id, player_name: id, value: v, kind: `${v}pt` } });
const stat = (id: string, st: string, extra: object = {}) => ({ event_type: 'note', payload: { team_side: 'A', player_id: id, player_name: id, kind: 'stat', stat: st, ...extra } });

describe('BB8 · the box score', () => {
  it('makes, misses, rebounds split, turnovers', () => {
    const ev = [shot('p1', 2), shot('p1', 3), shot('p1', 1), stat('p1', 'miss', { shot: '3' }), stat('p1', 'miss', { shot: 'ft' }), stat('p1', 'miss', { shot: '2' }), stat('p1', 'oreb'), stat('p1', 'dreb'), stat('p1', 'rebound'), stat('p1', 'turnover')];
    const line = aggregatePlayers('basketball', ev) as any;
    expect(line.p1).toMatchObject({ points: 6, fgm: 2, fga: 4, tpm: 1, tpa: 2, ftm: 1, fta: 2, oreb: 1, dreb: 1, rebounds: 3, turnovers: 1 });
  });
  it('3x3: a 1 is a field goal, not a free throw', () => {
    const line = aggregatePlayers('basketball', [shot('p1', 1), shot('p1', 2)], { pointSet: '12' }) as any;
    expect(line.p1).toMatchObject({ fgm: 2, fga: 2 });
    expect(line.p1.ftm).toBeUndefined();
  });
  it('the boards: shooting % once a miss is kept, efficiency once the box score is', () => {
    const players = aggregatePlayers('basketball', [shot('p1', 2), shot('p2', 2, 'B'), stat('p1', 'miss', { shot: '2' }), stat('p1', 'turnover')]);
    const boards = sportBoards('basketball', [{ id: 'm1', team_a_id: 'T', team_b_id: 'U', winner_team_id: 'T', score_summary: { players } as never }], { T: 'Kings', U: 'Hawks' });
    const fg = boards.find((b) => b.stat === 'fg_pct')!;
    expect(fg.rows.map((r) => [r.name, r.value, r.detail])).toEqual([['p2', 100, '1/1'], ['p1', 50, '1/2']]);
    // p1: 2 points − 1 missed shot − 1 turnover = 0 (not ranked); p2: 2.
    expect(boards.find((b) => b.stat === 'efficiency')!.rows.map((r) => [r.name, r.value])).toEqual([['p2', 2]]);
    expect(boards.find((b) => b.stat === 'ft_pct')).toBeUndefined();
    // Points only: no shooting or efficiency boards.
    const plain = sportBoards('basketball', [{ id: 'm1', team_a_id: 'T', team_b_id: 'U', winner_team_id: 'T', score_summary: { players: aggregatePlayers('basketball', [shot('p1', 2)]) } as never }], { T: 'Kings', U: 'Hawks' });
    expect(plain.map((b) => b.title)).toEqual(['Top scorers', 'Assists']);
  });
});

describe('BB6 · a series read game by game', () => {
  const end = { event_type: 'note', payload: { kind: 'game_end' } };
  const s = (side: 'A' | 'B', v = 2) => ({ event_type: 'score', payload: { team_side: side, value: v, kind: `${v}pt` } });
  it('basketball best of 3, decided in game 3', () => {
    const r = { ...standardRules('basketball'), tie: seriesSpec(3) } as MatchRules;
    const t = rollupTieSpec('basketball', r, seriesSpec(3), [s('A'), end, s('B'), s('B'), end, s('A', 3), end], sideOf);
    expect(t.tie).toMatchObject({ rubbersA: 2, rubbersB: 1, decided: 'A' });
    expect(t.results.map((x) => [x.unitsA, x.unitsB])).toEqual([[2, 0], [0, 4], [3, 0]]);
    expect([t.setsA, t.setsB]).toEqual([[2, 0, 3], [0, 4, 0]]);
  });
  it('football: an own goal counts for the other side', () => {
    const goal = (side: 'A' | 'B', kind = 'goal') => ({ event_type: 'score', payload: { team_side: side, kind } });
    const r = { ...standardRules('football'), tie: seriesSpec(3) } as MatchRules;
    const t = rollupTieSpec('football', r, seriesSpec(3), [goal('A', 'own_goal'), end], sideOf);
    expect(t.results[0]).toMatchObject({ unitsA: 0, unitsB: 1, winner: 'B' });
  });
  it('the validator takes a series for the team sports, not an even one', () => {
    expect(rulesRefusal('hockey', { ...standardRules('hockey'), tie: seriesSpec(5) } as MatchRules)).toBeNull();
    expect(rulesRefusal('basketball', { ...standardRules('basketball'), tie: seriesSpec(4) } as MatchRules)).not.toBeNull();
  });
});

describe('BB4 · typed periods and series (server copy)', () => {
  it('reads the same as the app', () => {
    expect(typedPeriodPoints('basketball', null, [{ a: 22, b: 18 }, { a: 15, b: 20 }, { a: 24, b: 19 }, { a: 20, b: 17 }]).text).toBe('81-74 (Q1 22-18, Q2 15-20, Q3 24-19, Q4 20-17)');
    expect(typedSeriesPoints('hockey', seriesSpec(3), [{ a: 2, b: 1 }, { a: 3, b: 0 }]).winner).toBe('A');
  });
});

describe('the shared rules', () => {
  it('overtime keeps the 4th quarter’s team fouls; 3x3 is valid', () => {
    const pc = { event_type: 'period_change', payload: {} };
    const f = { event_type: 'foul', payload: { team_side: 'A' } };
    expect(foulTally([pc, pc, pc, f, f, pc, f], 5, { regulation: 4 }).team.A).toBe(3);
    expect(rulesRefusal('basketball', { ...standardRules('basketball'), ...BASKETBALL_3X3 } as MatchRules)).toBeNull();
  });
  it('3x3’s capped average (server standings)', () => {
    const m = { team_a_id: 'X', team_b_id: 'Y', winner_team_id: 'X', status: 'completed', score_summary: { A: { score: '25' }, B: { score: '18' } } };
    const st = computeStats(['X', 'Y'], [m]);
    expect([st.get('X')!.cappedFor, st.get('Y')!.cappedFor]).toEqual([21, 18]);
  });
});
