/** Audit #91 (11 Oct 2026): Home's "your live match" showed a VOIDED match — your own live list skipped the voided filter. */
import { shouldHideVoided } from '../utils/matchVoid';

test('your own live and upcoming lists hide voided matches; your whole list keeps them', () => {
  expect(shouldHideVoided({ status: 'live', mine: true })).toBe(true);
  expect(shouldHideVoided({ status: 'scheduled', mine: true })).toBe(true);
  expect(shouldHideVoided({ mine: true })).toBe(false);
  expect(shouldHideVoided({ status: 'completed', mine: true })).toBe(false);
  expect(shouldHideVoided({ status: 'live', teamScoped: true })).toBe(false);
});
