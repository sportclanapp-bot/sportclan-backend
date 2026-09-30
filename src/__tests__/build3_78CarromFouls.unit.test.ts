/** BUILD 3.78 · a carrom foul on the timeline; it never scores. */
import { sportCommentary } from '../utils/commentary';
import { carromReplay } from '../utils/carromCore';

test('said, and not scored', () => {
  expect(sportCommentary('foul', { team_side: 'A' }, { sport: 'carrom', teamA: 'Strikers', teamB: 'Rebounds', period: 1 } as never)).toBe('🚫 Foul — Strikers (a piece due)');
  expect(carromReplay([], 2).points).toEqual({ A: 0, B: 0 }); // the replay reads boards only
});
