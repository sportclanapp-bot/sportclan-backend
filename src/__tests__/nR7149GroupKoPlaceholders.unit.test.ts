/**
 * N-R7-149 (Step 2 · Batch 8, SP-CHS-F01): a groups → knockout bracket read 'TBD v TBD' until the
 * groups were played; its first round now names the places — 'Winner A' v 'Runner-up B', 'Winner B'
 * v 'Runner-up A' — drawn as the real seeding draws them (group-mates apart, cross-paired).
 */
import { groupKnockoutPlaceholders } from '../controllers/tournaments.controller';

describe('N-R7-149 · knockout places named from the groups', () => {
  it('2 groups, top 2: Winner A v Runner-up B, Winner B v Runner-up A', () => {
    const r = groupKnockoutPlaceholders(['A', 'B'], 2, 4);
    expect(r).toHaveLength(2);
    expect(r.map((m) => [m.a, m.b].sort().join(' v ')).sort()).toEqual(['Runner-up A v Winner B', 'Runner-up B v Winner A']);
  });
  it('4 groups, top 2: every first-round game pairs a winner with another group’s runner-up', () => {
    const r = groupKnockoutPlaceholders(['A', 'B', 'C', 'D'], 2, 8);
    expect(r).toHaveLength(4);
    for (const m of r) {
      const [w, ru] = [m.a, m.b].sort((x, y) => (x.startsWith('Winner') ? -1 : 1) - (y.startsWith('Winner') ? -1 : 1));
      expect(w).toMatch(/^Winner [A-D]$/); expect(ru).toMatch(/^Runner-up [A-D]$/);
      expect(w.slice(-1)).not.toBe(ru.slice(-1));
    }
  });
  it('3 groups, top 2 in a draw of 8: the open places read BYE, or Best next-placed when they fill them', () => {
    expect(groupKnockoutPlaceholders(['A', 'B', 'C'], 2, 8).flatMap((m) => [m.a, m.b]).filter((x) => x === 'BYE')).toHaveLength(2);
    expect(groupKnockoutPlaceholders(['A', 'B', 'C'], 2, 8, [], true).flatMap((m) => [m.a, m.b]).filter((x) => x === 'Best next-placed')).toHaveLength(2);
  });
  it('a seed straight into the knockout keeps its name', () => {
    const names = groupKnockoutPlaceholders(['A', 'B'], 1, 4, [{ id: 's1', name: 'Top Seed' }, { id: 's2', name: 'Second Seed' }]).flatMap((m) => [m.a, m.b]);
    expect(names.sort()).toEqual(['Second Seed', 'Top Seed', 'Winner A', 'Winner B']);
  });
});
