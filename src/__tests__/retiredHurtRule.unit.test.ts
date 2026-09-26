import { isDismissal } from '../utils/cricketRules';
/**
 * Retired hurt is not a wicket; retired out is (2026-09-26). Shared rule,
 * identical in both repos (cricketRules.ts); this fixture table is identical too.
 */
describe('isDismissal', () => {
  test('retired hurt is not a dismissal, however it is spelled', () => {
    for (const k of ['retired_hurt', 'retiredhurt', 'Retired Hurt', 'retired-hurt']) expect(isDismissal(k)).toBe(false);
  });
  test('retired out and every other kind is; so is an old wicket with no kind', () => {
    for (const k of ['retired_out', 'bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', '', null, undefined, 'out']) expect(isDismissal(k)).toBe(true);
  });
});
