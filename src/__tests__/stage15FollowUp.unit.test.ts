/**
 * Stage 15 follow-up (Oct 2026), the server's side: a series game on
 * penalties (goals and shoot-out apart), a cricket series, 3x3 free throws.
 */
import { aggregatePlayers, rollupTieSpec } from '../controllers/scoring.controller';
import { standardRules, rulesRefusal, type MatchRules } from '../utils/matchRules';
import { seriesSpec } from '../utils/tieCore';
import { typedSeriesPoints } from '../utils/typedScore';
import { cricketSeries, cricketGameEvents } from '../utils/cricketRules';
import { sportCommentary } from '../utils/commentary';

const sideOf = (p: any): 'A' | 'B' => (p?.team_side === 'B' ? 'B' : 'A');
const goal = (side: 'A' | 'B') => ({ event_type: 'score', payload: { team_side: side, kind: 'goal', value: 1 } });
const end = { event_type: 'note', payload: { kind: 'game_end' } };
const kick = (side: 'A' | 'B', scored: boolean) => ({ event_type: 'note', payload: { kind: 'shootout_kick', team_side: side, scored } });

describe('a series game decided on penalties', () => {
  it('the kicks decide the game; its goals stay 1–1; the shoot-out is kept on the game', () => {
    const r = { ...standardRules('football'), tie: seriesSpec(3) } as MatchRules;
    const t = rollupTieSpec('football', r, seriesSpec(3), [goal('A'), end, goal('A'), goal('B'), kick('A', true), kick('B', false), kick('A', true), kick('B', false), kick('A', true), kick('B', false), end], sideOf);
    expect(t.tie.decided).toBe('A');
    expect(t.results[1]).toMatchObject({ unitsA: 1, unitsB: 1, winner: 'A', pens: { A: 3, B: 0 } });
    expect([t.setsA, t.setsB]).toEqual([[1, 1], [0, 1]]);
  });
  it('the typed tally note (hockey)', () => {
    const r = { ...standardRules('hockey'), tie: seriesSpec(3) } as MatchRules;
    const got = typedSeriesPoints('hockey', seriesSpec(3), [{ a: 1, b: 1, pa: 4, pb: 3 }, { a: 2, b: 0 }]);
    expect(got.text).toBe('2-0 (G1 1-1 (4-3 shootout), G2 2-0)');
    const t = rollupTieSpec('hockey', r, seriesSpec(3), got.events as never, sideOf);
    expect(t.results[0]).toMatchObject({ winner: 'A', pens: { A: 4, B: 3 }, unitsA: 1, unitsB: 1 });
    expect(sportCommentary('note', { kind: 'shootout', A: 4, B: 3 }, { sport: 'hockey', teamA: 'Reds', teamB: 'Blues', period: 1 })).toBe('🥅 Shoot-out — Reds won 4–3');
  });
  it('the kicks aren’t goals for anyone', () => {
    const p = aggregatePlayers('football', [{ event_type: 'score', payload: { team_side: 'A', kind: 'goal', player_id: 'u1', player_name: 'U' } }, { event_type: 'note', payload: { kind: 'shootout_kick', team_side: 'A', scored: true, player_id: 'u1', player_name: 'U' } }]) as any;
    expect(p.u1.goals).toBe(1);
  });
});

describe('a cricket series', () => {
  it('the rules, the games and who won them', () => {
    expect(rulesRefusal('cricket', { ...standardRules('cricket'), tie: seriesSpec(5) } as MatchRules)).toBeNull();
    const ev = [
      { event_type: 'ball', payload: { team_side: 'A', runs: 4 } },
      { event_type: 'note', payload: { kind: 'game_end', game: 1, winner: 'B', next_first: 'A' } },
      { event_type: 'ball', payload: { team_side: 'A', runs: 1, game: 2 } },
      { event_type: 'note', payload: { kind: 'game_end', game: 2, winner: 'A', next_first: 'B' } },
      { event_type: 'ball', payload: { team_side: 'B', runs: 2, game: 3 } },
      { event_type: 'note', payload: { kind: 'game_end', game: 3, winner: 'A' } },
    ];
    expect(cricketSeries(ev, 3)).toMatchObject({ wonA: 2, wonB: 1, decided: 'A', current: 3 });
    expect(cricketGameEvents(ev, 3)).toEqual([ev[4]]);
  });
});

describe('3x3 free throws', () => {
  it('a free throw (kind ft) is FT; a 1 is a field goal; a miss beyond the arc isn’t a 3-pointer', () => {
    const p = { team_side: 'A', player_id: 'u1', player_name: 'U' };
    const line = (aggregatePlayers('basketball', [
      { event_type: 'score', payload: { ...p, kind: 'ft', value: 1 } },
      { event_type: 'score', payload: { ...p, kind: '1pt', value: 1 } },
      { event_type: 'note', payload: { ...p, kind: 'stat', stat: 'miss', shot: '3' } },
    ], { pointSet: '12' }) as any).u1;
    expect(line).toMatchObject({ points: 2, ftm: 1, fta: 1, fgm: 1, fga: 2 });
    expect(line.tpa).toBeUndefined();
    const ctx = { sport: 'basketball', teamA: 'Kings', teamB: 'Hawks', period: 1, threeByThree: true };
    expect(sportCommentary('score', { team_side: 'A', kind: 'ft', value: 1 }, ctx)).toBe('🏀 Free throw — Kings');
    expect(sportCommentary('score', { team_side: 'A', kind: '1pt', value: 1 }, ctx)).toBe('🏀 1 inside the arc — Kings');
    // 5x5 unchanged.
    expect(sportCommentary('score', { team_side: 'A', kind: '1pt', value: 1 }, { ...ctx, threeByThree: false })).toBe('🏀 Free throw — Kings');
  });
});
