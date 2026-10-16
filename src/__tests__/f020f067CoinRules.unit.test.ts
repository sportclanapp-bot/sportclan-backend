/**
 * F020 + F067 (launch test plan) · the Wallet's coin words disagreed with what the
 * server awards. The numbers now live in utils/coinRules.ts — byte-identical in the
 * app, whose Wallet says them — and the server awards by them.
 */
import fs from 'fs';
import path from 'path';
import { readOtherRepo, testWithOtherRepo } from './helpers/otherRepo';
import { COIN_RULES, EARN_WORDS } from '../utils/coinRules';
import { REFERRAL_WINDOW_DAYS, referralApplyUntil } from '../controllers/referrals.controller';

jest.mock('../utils/supabase', () => ({ supabase: {} }));

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

it('the rules are what the server has always paid', () => {
  expect(COIN_RULES).toEqual({ checkIn: 5, post: 2, postsPerDay: 5, referral: 20, referralWindowDays: 30 });
  expect(EARN_WORDS.post).toBe('2 coins for each of your first 5 posts a day');
  expect(EARN_WORDS.invite).toBe('You both get 20 when they enter your code within 30 days of joining');
});

it('the server awards by them', () => {
  const c = code('controllers/community.controller.ts');
  expect(c).toMatch(/if \(todayN <= COIN_RULES\.postsPerDay\)/);
  expect(c).toMatch(/`community_post_\$\{today\}_\$\{todayN\}`, COIN_RULES\.post,/);
  expect(code('controllers/referrals.controller.ts')).toMatch(/const REFERRAL_COINS = COIN_RULES\.referral;/);
  expect(code('controllers/users.controller.ts')).toMatch(/const CHECKIN_COINS = COIN_RULES\.checkIn;/);
  expect(REFERRAL_WINDOW_DAYS).toBe(30);
  expect(referralApplyUntil('2026-10-01T00:00:00.000Z')).toBe('2026-10-31T00:00:00.000Z');
});

testWithOtherRepo('coinRules.ts is byte-for-byte the app’s', () => {
  expect(fs.readFileSync(path.join(__dirname, '../utils/coinRules.ts'), 'utf8')).toBe(readOtherRepo('src/utils/coinRules.ts'));
});
