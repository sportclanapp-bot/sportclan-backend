/**
 * Stage 10 · TT2 · groups → knockout: seeds straight into the knockout come
 * first; a group's runner-up lands in the other half from its winner.
 */
import { placeGroupTiersApart } from '../utils/koFirstRound';
import { groupsKnockoutSize } from '../utils/standings';
import { settingsRefusal } from '../utils/tournamentSettings';

// Bracket halves for seed numbers in an 8 and a 16 (standard order).
const halfOf = (size: number, seed: number) => {
  let order = [1, 2];
  while (order.length < size) { const sum = order.length * 2 + 1; order = order.flatMap((s) => [s, sum - s]); }
  return order.indexOf(seed) < size / 2 ? 'top' : 'bottom';
};

test('4 groups, top 2: every runner-up in the other half from its winner', () => {
  const group = (id: string) => id[0];
  const out = placeGroupTiersApart([], [['A1', 'B1', 'C1', 'D1'], ['A2', 'B2', 'C2', 'D2']], group, 8);
  for (const g of ['A', 'B', 'C', 'D']) expect(halfOf(8, out.indexOf(`${g}1`) + 1)).not.toBe(halfOf(8, out.indexOf(`${g}2`) + 1));
  expect(out.slice(0, 4)).toEqual(['A1', 'B1', 'C1', 'D1']); // the winners keep their seeds
});

test('8 seeds straight in, then 8 groups’ winners and runners-up in a 32 — still apart', () => {
  const direct = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
  const gs = 'ABCDEFGH'.split('');
  const out = placeGroupTiersApart(direct, [gs.map((g) => `${g}1`), gs.map((g) => `${g}2`)], (id) => (id.startsWith('S') ? undefined : id[0]), 32);
  expect(out.slice(0, 8)).toEqual(direct);
  for (const g of gs) expect(halfOf(32, out.indexOf(`${g}1`) + 1)).not.toBe(halfOf(32, out.indexOf(`${g}2`) + 1));
});

test('the knockout makes room for the direct seeds; the setting is checked', () => {
  expect(groupsKnockoutSize(8, 2, null, 8)).toBe(32);
  expect(groupsKnockoutSize(4, 2, null)).toBe(8);
  expect(settingsRefusal('table-tennis', 'groups_knockout', { v: 1, directSeeds: 8 })).toBeNull();
  expect(settingsRefusal('table-tennis', 'knockout', { v: 1, directSeeds: 8 })?.error).toBe('Seeds go straight to the knockout in groups → knockout.');
  expect(settingsRefusal('badminton', 'groups_knockout', { v: 1, directSeeds: -1 })?.error).toMatch(/whole number/);
});
