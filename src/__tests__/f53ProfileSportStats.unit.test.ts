/**
 * F-53 (MATCH_CREATE_TEST_5, F1): A was credited with a Smoke Tigers goal, yet
 * A's football profile read goals 0. The per-sport profile stats counted event
 * types the scoring pad never sends ('goal', 'yellow_card', 'basket') by who
 * ENTERED the event (the scorer). They now read the scorecard's per-player
 * rollups, keyed by the credited player_id.
 */
import fs from 'fs';
import path from 'path';
jest.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
import { aggregateGoalPlayers, aggregatePointPlayers, aggregateRallyPlayers } from '../controllers/scoring.controller';

const src = fs.readFileSync(path.join(__dirname, '../controllers/users.controller.ts'), 'utf8');
const stats = src.slice(src.indexOf("} else if ((slug === 'football' || slug === 'hockey')"), src.indexOf('points_won: pointsWon'));

test('F1 as scored: A 1 goal, B 1, D 1; the own goal is nobody\'s', () => {
  const ev = [
    { event_type: 'score', payload: { team_side: 'A', kind: 'goal', value: 1, player_id: 'a' } },
    { event_type: 'score', payload: { team_side: 'B', kind: 'own_goal' } },
    { event_type: 'card', payload: { team_side: 'A', kind: 'yellow' } },
    { event_type: 'score', payload: { team_side: 'B', kind: 'goal', value: 1, player_id: 'b' } },
    { event_type: 'score', payload: { team_side: 'B', kind: 'goal', value: 1, player_id: 'd' } },
  ];
  const g = aggregateGoalPlayers(ev);
  expect([g.a?.goals, g.b?.goals, g.d?.goals]).toEqual([1, 1, 1]);
});

test('basketball points and rally points are the credited player\'s', () => {
  expect(aggregatePointPlayers([{ event_type: 'score', payload: { value: 3, player_id: 'a' } }, { event_type: 'score', payload: { value: 2, player_id: 'a' } }]).a?.points).toBe(5);
  expect(aggregateRallyPlayers([{ event_type: 'score', payload: { player_id: 'b' } }]).b?.points).toBe(1);
});

test('the profile reads the rollups, not created_by', () => {
  expect(stats).toContain('const line = aggregateGoalPlayers(ev)[id];');
  expect(stats).toContain('total_points: aggregatePointPlayers(ev)[id]?.points ?? 0,');
  expect(src).toContain('const pointsWon = aggregateRallyPlayers(');
  expect(stats).not.toContain('created_by === id');
  expect(stats).toContain("...(slug === 'hockey' ? { green_cards: cards('green') } : {}),");
});

test('only this sport\'s completed, unvoided matches count', () => {
  const parts = src.slice(src.indexOf('const partsP = Promise.resolve(supabase'), src.indexOf('cityP.catch('));
  expect(parts).toContain(".is('match.voided_at', null)");
  expect(parts).toContain(".eq('match.sport_id', sportId)");
  expect(parts).toContain(".eq('match.status', 'completed')");
});
