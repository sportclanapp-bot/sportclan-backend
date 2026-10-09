/** Stage 12 · CH9 · FIDE's Berger tables: every sport's round robin and league (a double round robin, sides reversed). */
import { bergerRounds } from '../utils/groupOrder';

const words = (rs: Array<Array<[number, number]>>) => rs.map((r) => r.map(([a, b]) => `${a + 1}-${b + 1}`).join(' '));

test('FIDE’s table for 6 and for 4, exactly', () => {
  expect(words(bergerRounds(6))).toEqual(['1-6 2-5 3-4', '6-4 5-3 1-2', '2-6 3-1 4-5', '6-5 1-4 2-3', '3-6 4-2 5-1']);
  expect(words(bergerRounds(4))).toEqual(['1-4 2-3', '4-3 1-2', '2-4 3-1']);
});

for (const n of [3, 4, 5, 6, 7, 8, 10, 11, 12, 16, 20]) {
  test(`${n} players: everyone meets once; colours as even as a round robin allows`, () => {
    const rs = bergerRounds(n);
    expect(rs.length).toBe(n % 2 === 0 ? n - 1 : n);
    const met = new Set<string>();
    for (const r of rs) {
      const seen = new Set<number>();
      for (const [a, b] of r) { expect(seen.has(a) || seen.has(b)).toBe(false); seen.add(a); seen.add(b); const k = [a, b].sort().join(); expect(met.has(k)).toBe(false); met.add(k); }
    }
    expect(met.size).toBe((n * (n - 1)) / 2);
    for (let p = 0; p < n; p++) {
      const whites = rs.flat().filter(([a]) => a === p).length;
      const blacks = rs.flat().filter(([, b]) => b === p).length;
      expect(Math.abs(whites - blacks)).toBeLessThanOrEqual(n % 2 === 0 ? 1 : 0);
    }
  });
  test(`${n} players, double round robin: each pair twice, sides reversed; never 3 of a colour in a row across the join`, () => {
    const rs = bergerRounds(n, true);
    const one = bergerRounds(n).length;
    expect(rs.length).toBe(2 * one);
    const legs = new Map<string, Array<[number, number]>>();
    for (const r of rs) for (const [a, b] of r) { const k = [a, b].sort().join(); legs.set(k, [...(legs.get(k) ?? []), [a, b]]); }
    for (const v of legs.values()) { expect(v.length).toBe(2); expect(v[0]).toEqual([v[1]![1], v[1]![0]]); }
    for (let p = 0; p < n; p++) {
      const seq = rs.map((r) => { const g = r.find(([a, b]) => a === p || b === p); return g ? (g[0] === p ? 'W' : 'B') : '-'; }).join('');
      const join = seq.slice(one - 2, one + 2).replace(/-/g, '');
      // 4 players: no order of rounds avoids it (3 rounds a cycle) — FIDE's swap or none, two players get three.
      if (n !== 4) expect(join).not.toMatch(/WWW|BBB/);
    }
  });
}
