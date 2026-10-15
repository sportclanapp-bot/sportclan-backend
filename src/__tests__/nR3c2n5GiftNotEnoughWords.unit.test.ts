/**
 * N-R3C2-5 (launch test plan) · a gift the balance couldn't cover was refused with the
 * bare words "Insufficient coins" — what the app then showed. The refusal says what the
 * gift costs (and the balance, when known) and carries a code the app acts on.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../utils/supabase', () => ({ supabase: {} }));
// eslint-disable-next-line import/first
import * as gifts from '../controllers/gifts.controller';

it('the refusal is plain, with a code and the old fields', () => {
  const notEnough = (gifts as any).notEnoughCoins;
  expect(notEnough({ name: 'Flowers', cost: 5 }, 3)).toEqual({
    error: 'Not enough coins: Flowers costs 5. You have 3.', code: 'INSUFFICIENT_COINS', required: 5, current: 3,
  });
  expect(notEnough({ name: 'Flowers', cost: 5 })).toEqual({ error: 'Not enough coins: Flowers costs 5.', code: 'INSUFFICIENT_COINS', required: 5 });
});

it('no path still answers the bare "Insufficient coins"', () => {
  expect(fs.readFileSync(path.join(__dirname, '../controllers/gifts.controller.ts'), 'utf8')).not.toMatch(/'Insufficient coins'/);
});
