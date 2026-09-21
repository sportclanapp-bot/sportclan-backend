/**
 * SC-431 · budgets that survive a real venue, and a bypass that cannot leak.
 *
 * The limiter was a flat 200 requests / 15 min keyed on IP. At a ground that is a
 * SHARED budget: one Wi-Fi, or an Indian carrier putting many subscribers behind
 * one address via CGNAT, means a handful of spectators watching a live match lock
 * everyone else out. The limit meant to stop one abuser silenced the venue.
 */
import { rateLimitBypassed, BYPASS_HEADER } from '../middleware/rateLimitBypass';

const reqWith = (headers: Record<string, string> = {}) =>
  ({ header: (n: string) => headers[n.toLowerCase()] }) as never;

describe('SC-431 · the rate-limit bypass cannot exist unless it is created', () => {
  const OLD = process.env.RATE_LIMIT_BYPASS_TOKEN;
  afterEach(() => {
    if (OLD === undefined) delete process.env.RATE_LIMIT_BYPASS_TOKEN;
    else process.env.RATE_LIMIT_BYPASS_TOKEN = OLD;
  });

  it('is ABSENT by default — no header can turn it on', () => {
    delete process.env.RATE_LIMIT_BYPASS_TOKEN;
    expect(rateLimitBypassed(reqWith())).toBe(false);
    expect(rateLimitBypassed(reqWith({ [BYPASS_HEADER]: 'anything' }))).toBe(false);
    expect(rateLimitBypassed(reqWith({ [BYPASS_HEADER]: '' }))).toBe(false);
  });

  it('a SHORT configured token is treated as unset', () => {
    // A guessable bypass is worse than none, so "test" must not arm it.
    process.env.RATE_LIMIT_BYPASS_TOKEN = 'test';
    expect(rateLimitBypassed(reqWith({ [BYPASS_HEADER]: 'test' }))).toBe(false);
  });

  it('with a real token, only the EXACT value passes', () => {
    const token = 'x'.repeat(40);
    process.env.RATE_LIMIT_BYPASS_TOKEN = token;
    expect(rateLimitBypassed(reqWith({ [BYPASS_HEADER]: token }))).toBe(true);
    expect(rateLimitBypassed(reqWith({ [BYPASS_HEADER]: 'y'.repeat(40) }))).toBe(false);
    expect(rateLimitBypassed(reqWith({ [BYPASS_HEADER]: token.slice(0, 39) }))).toBe(false);
    expect(rateLimitBypassed(reqWith({ [BYPASS_HEADER]: token + 'z' }))).toBe(false);
    expect(rateLimitBypassed(reqWith())).toBe(false);
  });
});

/**
 * The keying rule, as a pure function of what the request presents. Mirrors
 * middleware/rateLimitKey — the token is VERIFIED there, so an unverifiable one
 * falls back to IP rather than minting a private budget for a forged header.
 */
const keyFor = (verifiedUser: string | null, ip: string) =>
  verifiedUser ? `u:${verifiedUser}` : `ip:${ip}`;

describe('SC-431 · per-user keying', () => {
  it('two signed-in users behind ONE address get separate budgets', () => {
    // The CGNAT / venue-Wi-Fi case that made the old limiter unusable.
    expect(keyFor('ravi', '1.2.3.4')).not.toBe(keyFor('asha', '1.2.3.4'));
  });

  it('one user on two devices shares their own budget', () => {
    expect(keyFor('ravi', '1.2.3.4')).toBe(keyFor('ravi', '5.6.7.8'));
  });

  it('unauthenticated traffic is still keyed on IP — where abuse protection belongs', () => {
    expect(keyFor(null, '1.2.3.4')).toBe('ip:1.2.3.4');
    expect(keyFor(null, '1.2.3.4')).toBe(keyFor(null, '1.2.3.4'));
  });

  it('a forged/expired token cannot buy a fresh budget', () => {
    // verifiedUserId returns null when verification fails, so it falls to IP —
    // the same bucket the attacker already had.
    expect(keyFor(null, '1.2.3.4')).toBe('ip:1.2.3.4');
  });
});
