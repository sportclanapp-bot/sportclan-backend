/**
 * F020 + F067 (launch test plan) · the coin rules, in one file kept byte-identical
 * in the app (src/utils/coinRules.ts) and the server (src/utils/coinRules.ts). The
 * server awards by these numbers and the Wallet says them in these words — they
 * had drifted apart ("your first post each day", "both get coins on signup").
 */
import { plural } from './plural';

export const COIN_RULES = {
  /** Daily check-in, once per IST day. */
  checkIn: 5,
  /** A community post: this many coins for each of the first `postsPerDay` posts of an IST day. */
  post: 2,
  postsPerDay: 5,
  /** An invite code: both sides get this when the friend enters it… */
  referral: 20,
  /** …within this many days of the friend joining. */
  referralWindowDays: 30,
} as const;

/** What the Wallet's "Earn coins" rows say. */
export const EARN_WORDS = {
  post: `${plural(COIN_RULES.post, 'coin')} for each of your first ${plural(COIN_RULES.postsPerDay, 'post')} a day`,
  invite: `You both get ${COIN_RULES.referral} when they enter your code within ${plural(COIN_RULES.referralWindowDays, 'day')} of joining`,
} as const;
