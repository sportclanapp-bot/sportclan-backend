/**
 * SC-431 · the typing TTL, tested with a clock instead of a stopwatch.
 *
 * This behaviour used to be covered only by an integration test that slept NINE
 * REAL SECONDS waiting for the server's ~8s TTL to lapse, inside a 20s budget.
 * That is inherently timing-sensitive, and it duly went flaky the moment the
 * suite ran under parallel load — the HTTP round-trips plus the sleep simply
 * overran the budget.
 *
 * Expiry is a pure comparison. It belongs here, where "nine seconds later" costs
 * nothing and never flakes, leaving the integration test to prove only the thing
 * that genuinely needs a server: that a ping is visible to the other party.
 */
import { isTypingActive, TYPING_TTL_MS } from '../controllers/messages.controller';

const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const atOffset = (ms: number) => new Date(NOW + ms).toISOString();

describe('SC-431 · typing expiry', () => {
  it('a fresh ping is active for the whole TTL', () => {
    const until = atOffset(TYPING_TTL_MS);
    expect(isTypingActive(until, NOW)).toBe(true);
    expect(isTypingActive(until, NOW + TYPING_TTL_MS - 1)).toBe(true);
  });

  it('lapses the instant it expires — this is what the 9s sleep was checking', () => {
    const until = atOffset(TYPING_TTL_MS);
    expect(isTypingActive(until, NOW + TYPING_TTL_MS)).toBe(false);
    expect(isTypingActive(until, NOW + TYPING_TTL_MS + 1000)).toBe(false);
  });

  it('never typing when there is no stamp at all', () => {
    expect(isTypingActive(null, NOW)).toBe(false);
    expect(isTypingActive(undefined, NOW)).toBe(false);
    expect(isTypingActive('', NOW)).toBe(false);
  });

  it('a malformed stamp reads as NOT typing, rather than throwing at a reader', () => {
    expect(isTypingActive('not a date', NOW)).toBe(false);
  });

  it('the TTL still exceeds the client re-ping and poll gap it exists to cover', () => {
    // ~3s re-ping and a 6s poll: a shorter TTL would make "typing…" flicker.
    expect(TYPING_TTL_MS).toBeGreaterThan(6000);
  });
});
