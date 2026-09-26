/**
 * Cards credited to a player (2026-09-26): the pad now asks who got the card
 * (optional); the scorecard rollup and the profile count them. Cards recorded
 * without a player stay team-only.
 */
import fs from 'fs';
import path from 'path';
jest.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
import { aggregateGoalPlayers } from '../controllers/scoring.controller';

test('cards per player, beside goals; an unattributed card counts for nobody', () => {
  const p = aggregateGoalPlayers([
    { event_type: 'score', payload: { team_side: 'A', kind: 'goal', player_id: 'a', player_name: 'A' } },
    { event_type: 'card', payload: { team_side: 'A', kind: 'yellow', player_id: 'a', player_name: 'A' } },
    { event_type: 'card', payload: { team_side: 'B', kind: 'red', player_id: 'b', player_name: 'B' } },
    { event_type: 'card', payload: { team_side: 'B', kind: 'green', player_id: 'b' } },
    { event_type: 'card', payload: { team_side: 'B', kind: 'yellow' } },
  ]);
  expect(p.a).toMatchObject({ goals: 1, yellow_cards: 1 });
  expect(p.b).toMatchObject({ goals: 0, red_cards: 1, green_cards: 1 });
  expect(Object.keys(p)).toEqual(['a', 'b']);
});

test('the profile counts the credited player\'s cards', () => {
  const u = fs.readFileSync(path.join(__dirname, '../controllers/users.controller.ts'), 'utf8');
  expect(u).toContain("const cards = (kind: string) => ev.filter((e) => e.event_type === 'card' && e.payload?.player_id === id && e.payload?.kind === kind).length;");
});
