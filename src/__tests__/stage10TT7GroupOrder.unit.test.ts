/** Stage 10 · TT7 · a group's matches in seeded order (ITTF): the top seeds meet last; groups interleaved. */
import { seededGroupFixtures, seededGroupRounds } from '../utils/groupOrder';

const fmt = (n: number) => seededGroupRounds(n).map((r) => r.map(([a, b]) => `${a + 1}-${b + 1}`).join(' '));

test('ITTF: groups of 3 and 4', () => {
  expect(fmt(3)).toEqual(['2-3', '1-3', '1-2']);
  expect(fmt(4)).toEqual(['1-4 2-3', '1-3 2-4', '1-2 3-4']);
});

test('any size: everyone meets once, 1 v 2 last, an odd group sits one out a round', () => {
  for (const n of [2, 5, 6, 7, 8, 12]) {
    const rounds = seededGroupRounds(n);
    const pairs = rounds.flat().map(([a, b]) => `${a}-${b}`);
    expect(new Set(pairs).size).toBe((n * (n - 1)) / 2);
    expect(pairs.length).toBe((n * (n - 1)) / 2);
    expect(rounds[rounds.length - 1]!.some(([a, b]) => a === 0 && b === 1)).toBe(true);
    for (const r of rounds) { const seen = r.flat(); expect(new Set(seen).size).toBe(seen.length); }
  }
});

test('the groups play round 1, then round 2… interleaved', () => {
  const out = seededGroupFixtures([['A1', 'A2', 'A3'], ['B1', 'B2', 'B3', 'B4']]).map((f) => `${f.round}:${f.a}-${f.b}`);
  expect(out).toEqual(['1:A2-A3', '1:B1-B4', '1:B2-B3', '2:A1-A3', '2:B1-B3', '2:B2-B4', '3:A1-A2', '3:B1-B2', '3:B3-B4']);
});
