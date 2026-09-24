/**
 * V-6 · voiding a ranked match takes back the +5 win coins; restoring gives them
 * back. Idempotent both ways, and safe under any void/restore sequence.
 */
import fs from 'fs';
import path from 'path';
import { planWinCoins, WIN_COINS } from '../utils/winCoins';

const participants = [{ user_id: 'a', team_side: 'A' }, { user_id: 'b', team_side: 'B' }];
const plan = (counts: boolean, ledger: Record<string, number>, balances: Record<string, number> = { a: 100, b: 100 }) =>
  planWinCoins({ counts, winnerSide: 'A', participants, ledger: new Map(Object.entries(ledger)), balances: new Map(Object.entries(balances)) });

test('void: the winner gives back exactly what the win paid; the loser is untouched', () => {
  expect(plan(false, { a: WIN_COINS })).toEqual([{ userId: 'a', delta: -WIN_COINS }]);
});

test('void twice: the second run changes nothing', () => {
  expect(plan(false, { a: 0 })).toEqual([]);
});

test('restore: the win pays again; restore twice changes nothing', () => {
  expect(plan(true, { a: 0 })).toEqual([{ userId: 'a', delta: WIN_COINS }]);
  expect(plan(true, { a: WIN_COINS })).toEqual([]);
});

test('a clawback never takes a balance below zero, and the ledger then restores the true difference', () => {
  expect(plan(false, { a: WIN_COINS }, { a: 2, b: 100 })).toEqual([{ userId: 'a', delta: -2 }]);
  // ledger now +3 net; restore owes only 2 to reach 5
  expect(plan(true, { a: 3 })).toEqual([{ userId: 'a', delta: 2 }]);
});

test('a casual match, or one with no winner, never pays win coins', () => {
  expect(planWinCoins({ counts: false, winnerSide: 'A', participants, ledger: new Map(), balances: new Map() })).toEqual([]);
  expect(planWinCoins({ counts: true, winnerSide: null, participants, ledger: new Map(), balances: new Map() })).toEqual([]);
});

test('void and restore both reconcile, and the adjustment is labelled as what it is', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
  const fn = (name: string) => src.slice(src.indexOf(`export async function ${name}`), src.indexOf('\nexport ', src.indexOf(`export async function ${name}`) + 10));
  expect(fn('voidMatch')).toContain('await reconcileWinCoins(id)');
  expect(fn('unvoidMatch')).toContain('await reconcileWinCoins(id)');
  const wc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'winCoins.ts'), 'utf8');
  expect(wc).toContain("'coins_reversed'");
  expect(wc).toContain('`${prefix}_adj_${');
});
