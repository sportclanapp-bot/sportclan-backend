/**
 * SC-434 · there are no tiers.
 *
 * Eight gates across the product asked one question before letting somebody host
 * a tournament, see their own stats, post an image or send a gift. This pins the
 * answer, and pins the two things that must NOT have changed with it: coins are
 * still earned the same way and still cost the same to spend.
 */
import { isPremiumActive } from '../utils/premium';

describe('SC-434 · every gate is open', () => {
  it('a user with no premium fields is treated as entitled', () => {
    expect(isPremiumActive({})).toBe(true);
  });

  it('an EXPIRED premium row is still entitled — the 1 Oct 2026 case', () => {
    // 2,501 users carry a complimentary expiry of 1 Oct 2026. Nothing reads it
    // any more, and this is the assertion that says so: when that date passes,
    // these users lose nothing.
    expect(isPremiumActive({ is_premium: true, premium_expires_at: '2020-01-01T00:00:00.000Z' })).toBe(true);
  });

  it('is_premium false is entitled', () => {
    expect(isPremiumActive({ is_premium: false, premium_expires_at: null })).toBe(true);
  });

  it('no user at all is entitled — a guest path must not accidentally re-gate', () => {
    expect(isPremiumActive(null)).toBe(true);
    expect(isPremiumActive(undefined)).toBe(true);
  });
});

describe('SC-434 · what did NOT change', () => {
  // These are the amounts the product decision explicitly kept. A test here is
  // cheap insurance against a later "tidy-up" quietly rebalancing the economy.
  it('gifts cost what they always cost', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCatalogue } = require('../controllers/gifts.controller');
    let payload: { gifts: Array<{ id: string; cost: number }> } | undefined;
    getCatalogue({}, { json: (p: never) => { payload = p; return undefined; } });
    const byId = Object.fromEntries((payload?.gifts ?? []).map((g) => [g.id, g.cost]));
    expect(byId).toEqual({
      gold_trophy: 15, silver_trophy: 10, gold_medal: 12, silver_medal: 8,
      best_player: 10, flowers: 5, star_player: 12, appreciation: 5,
      fire: 5, crown: 8,
    });
  });

  it('a gift is still a real cost — the catalogue has no free gift', () => {
    // Coins with nothing to spend them on would make every earn path pointless.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCatalogue } = require('../controllers/gifts.controller');
    let payload: { gifts: Array<{ cost: number }> } | undefined;
    getCatalogue({}, { json: (p: never) => { payload = p; return undefined; } });
    expect((payload?.gifts ?? []).every((g) => g.cost > 0)).toBe(true);
  });
});
