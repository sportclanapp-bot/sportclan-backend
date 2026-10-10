/**
 * Stage 16 · hockey (Oct 2026), the server's side: shoot-out points in both
 * standings, goals by how and set pieces, the boards, commentary, the rules.
 */
import { aggregatePlayers } from '../controllers/scoring.controller';
import { computeStats, pointsFor } from '../utils/standings';
import { pointsPresetFor } from '../utils/tournamentSettings';
import { sportBoards } from '../utils/sportLeaders';
import { sportCommentary } from '../utils/commentary';
import { rulesRefusal, standardRules, type MatchRules } from '../utils/matchRules';

describe('HK1 · shoot-out points (server standings)', () => {
  const games = [{ team_a_id: 'L', team_b_id: 'T', winner_team_id: 'L', status: 'completed', score_summary: { A: { score: 1 }, B: { score: 1 }, shootout: { A: 4, B: 3 } } }];
  it('as before without them; 2 and 1 with the new hockey default', () => {
    const before = computeStats(['L', 'T'], games as never, undefined, pointsFor('hockey', { points: { win: 3, draw: 1, loss: 0 } }));
    expect([before.get('L')!.points, before.get('T')!.points]).toEqual([3, 0]);
    const now = computeStats(['L', 'T'], games as never, undefined, pointsFor('hockey', { points: pointsPresetFor('hockey') }));
    expect([now.get('L')!.points, now.get('T')!.points]).toEqual([2, 1]);
  });
});

describe('HK2 · goals by how, set pieces, boards', () => {
  const g = (side: 'A' | 'B', id: string, how?: string, extra: object = {}) => ({ event_type: 'score', payload: { team_side: side, kind: 'goal', value: 1, player_id: id, player_name: id, ...(how ? { how } : {}), ...extra } });
  it('hockey: PC and stroke goals, a missed stroke', () => {
    const p = aggregatePlayers('hockey', [g('A', 'u1', 'pc'), g('A', 'u1', 'stroke'), g('A', 'u2'), { event_type: 'note', payload: { team_side: 'A', kind: 'pen_stroke', scored: false, player_id: 'u2', player_name: 'u2' } }]) as any;
    expect(p.u1).toMatchObject({ goals: 2, pc_goals: 1, stroke_goals: 1 });
    expect(p.u2).toMatchObject({ goals: 1, strokes_missed: 1 });
  });
  it('football: an old penalty (penalty: true), a free kick, a missed penalty', () => {
    const p = aggregatePlayers('football', [g('A', 'u1', undefined, { penalty: true }), g('A', 'u1', 'free_kick'), { event_type: 'note', payload: { team_side: 'A', kind: 'pen_missed', player_id: 'u1', player_name: 'u1' } }]) as any;
    expect(p.u1).toMatchObject({ goals: 2, pen_goals: 1, fk_goals: 1, pens_missed: 1 });
  });
  it('the hockey boards: PC goals, stroke goals, PC conversion by team', () => {
    const players = aggregatePlayers('hockey', [g('A', 'u1', 'pc'), g('A', 'u1', 'stroke')]);
    const boards = sportBoards('hockey', [{ id: 'm1', team_a_id: 'T', team_b_id: 'U', winner_team_id: 'T', score_summary: { A: { score: 2 }, B: { score: 0 }, players, set_pieces: { A: { pc: 4, pc_goals: 1 }, B: { pc: 0, pc_goals: 0 } } } as never }], { T: 'Kings', U: 'Hawks' });
    const conv = boards.find((b) => b.stat === 'pc_conversion')!;
    expect(conv.rows.map((r) => [r.name, r.value, r.detail])).toEqual([['Kings', 25, '1/4 corners']]);
    expect(boards.find((b) => b.stat === 'pc_goals')!.rows[0]!.value).toBe(1);
    expect(boards.find((b) => b.stat === 'stroke_goals')!.rows[0]!.detail).toBe('1/1 strokes');
  });
});

describe('commentary and the rules', () => {
  const ctx = { sport: 'hockey', teamA: 'Kings', teamB: 'Hawks', period: 1 };
  it('goal types, a stroke missed, a corner at the hooter, PC over, card minutes, the captain’s card', () => {
    expect(sportCommentary('score', { team_side: 'A', kind: 'goal', how: 'pc', player_name: 'Raj' }, ctx)).toBe('🥅 GOAL! Kings — Raj (penalty corner)');
    expect(sportCommentary('note', { team_side: 'A', kind: 'pen_stroke', scored: false, player_name: 'Raj' }, ctx)).toBe('🎯 Penalty stroke missed — Raj (Kings)');
    expect(sportCommentary('note', { team_side: 'B', kind: 'pen_corner', at_hooter: true }, ctx)).toBe('🏑 Penalty corner — Hawks (at the hooter: it’s played before the quarter ends)');
    expect(sportCommentary('note', { kind: 'pc_over' }, ctx)).toBe('🏑 Penalty corner over — no goal');
    expect(sportCommentary('card', { team_side: 'A', kind: 'yellow', minutes: 10, player_name: 'Raj' }, ctx)).toContain('· 10 min');
    expect(sportCommentary('card', { team_side: 'A', kind: 'yellow', captain: true, player_name: 'Raj' }, ctx)).toContain('to the captain');
    expect(sportCommentary('assist', { team_side: 'A', kind: 'assist', player_name: 'Raj' }, { ...ctx, sport: 'basketball' })).toBe('🅰️ Assist — Raj (Kings)');
  });
  it('hockey can say a level league match goes to a shoot-out; the takers rule is data', () => {
    expect(rulesRefusal('hockey', { ...standardRules('hockey'), drawAllowed: false } as MatchRules)).toBeNull();
    expect(rulesRefusal('football', { ...standardRules('football'), shootoutSameTakers: true } as MatchRules)).toBeNull();
    expect(rulesRefusal('hockey', { ...standardRules('hockey'), shootoutSameTakers: 'x' } as unknown as MatchRules)).not.toBeNull();
  });
});
