/** BUILD 3.65 · tennis doubles (players 2) in the shared rules; the server's replay ignores serve swaps. */
import { rulesRefusal, standardRules, tennisOptsOf } from '../utils/matchRules';
import { tennisReplay } from '../utils/tennisCore';

test('doubles rules; a partner swap never scores', () => {
  expect(rulesRefusal('tennis', { ...standardRules('tennis'), players: 2 })).toBeNull();
  expect(rulesRefusal('tennis', { ...standardRules('tennis'), players: 3 })?.field).toBe('players');
  expect(tennisReplay([], tennisOptsOf({ ...standardRules('tennis'), players: 2 })).points).toEqual({ A: 0, B: 0 });
});
