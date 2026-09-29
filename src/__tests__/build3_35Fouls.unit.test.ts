/**
 * BUILD 3.35 · basketball fouls: this period's team fouls (bonus from the 5th)
 * and each player's — fouled out at 5 (FIBA) or 6 (NBA). Same table both repos.
 */
import { foulTally, TEAM_FOUL_BONUS } from '../utils/basketballRules';
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

const foul = (side: string, id?: string, name?: string) => ({ event_type: 'foul', payload: { team_side: side, ...(id ? { player_id: id, player_name: name } : {}) } });
const pc = { event_type: 'period_change', payload: { kind: 'quarter' } };

test('team fouls reset each period; players count all game', () => {
  const log = [foul('A', 'p1', 'Rao'), foul('A', 'p1', 'Rao'), foul('B'), pc, foul('A', 'p1', 'Rao'), foul('A', 'p1', 'Rao'), foul('A', 'p1', 'Rao')];
  const t = foulTally(log, 5);
  expect(t.period).toBe(2);
  expect(t.team).toEqual({ A: 3, B: 0 });
  expect(t.players).toEqual([{ id: 'p1', name: 'Rao', side: 'A', fouls: 5, out: true }]);
  expect(foulTally(log, 6).players[0]?.out).toBe(false);
  expect(TEAM_FOUL_BONUS).toBe(5);
});
test('foul out at 5 or 6; standard 5; the label', () => {
  expect(standardRules('basketball').foulOut).toBe(5);
  expect(rulesRefusal('basketball', { ...standardRules('basketball'), foulOut: 6 })).toBeNull();
  expect(rulesRefusal('basketball', { ...standardRules('basketball'), foulOut: 4 })?.error).toBe('A player fouls out at 5 or 6.');
  expect(timedRulesLabel('basketball', { ...standardRules('basketball'), foulOut: 6 })).toBe('foul out at 6');
});
test('the scorecard counts a player’s fouls; the timeline names them', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { aggregatePointPlayers } = require('../controllers/scoring.controller');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sportCommentary } = require('../utils/commentary');
  const roll = aggregatePointPlayers([foul('A', 'p1', 'Rao'), foul('A', 'p1', 'Rao'), { event_type: 'score', payload: { team_side: 'A', player_id: 'p2', value: 2 } }]);
  expect(roll.p1).toMatchObject({ fouls: 2, points: 0 });
  expect(roll.p2).toEqual({ side: 'A', points: 2, assists: 0 }); // no foul, no field
  expect(sportCommentary('foul', { team_side: 'B', player_name: 'Rao' }, { sport: 'basketball', teamA: 'Lakers', teamB: 'Celtics', period: 0 })).toBe('✋ Foul — Rao (Celtics)');
});
