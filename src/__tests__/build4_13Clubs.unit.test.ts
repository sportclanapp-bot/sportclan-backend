/**
 * BUILD 4.13 · same-club entries kept apart in the draw (the Indian Carrom
 * Federation separates by state). Groups swap within a pot so clubs spread;
 * a first round swaps lower seeds so clubmates don't meet at once — without
 * undoing the groups → KO cross-pairing, and never moving a team the organiser
 * placed. Best-effort when a club has more entries than groups.
 */
import { separateClubsInGroups, separateClubsInRound1 } from '../utils/clubSeparation';
import { settingsRefusal } from '../utils/tournamentSettings';

const club: Record<string, string> = { a1: 'MH', a2: 'MH', b1: 'KA', b2: 'KA', c1: 'TN', c2: 'TN' };
const clubOf = (id: string) => club[id] ?? null;
const clubsIn = (g: string[]) => g.map(clubOf);

test('groups: two per state are spread so no group holds a pair', () => {
  // Dealt so each group got one state twice.
  const out = separateClubsInGroups([['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']], clubOf);
  for (const g of out) expect(new Set(clubsIn(g)).size).toBe(g.length);
  expect(out.flat().sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
  // pots kept: the first of each group is still a first-pot team
  expect(out.map((g) => g[0]).sort()).toEqual(['a1', 'b1', 'c1']);
});
test('groups: a team the organiser placed doesn’t move', () => {
  const out = separateClubsInGroups([['a1', 'a2'], ['b1', 'b2']], clubOf, new Set(['a2', 'b2']));
  expect(out[0]).toContain('a2');
  expect(out[1]).toContain('b2');
});
test('groups: more clubmates than groups — as few pairs as possible, nobody lost', () => {
  const many = (id: string) => (id.startsWith('x') ? 'MH' : null);
  const out = separateClubsInGroups([['x1', 'x2', 'y1'], ['x3', 'y2', 'y3']], many);
  expect(out.flat().sort()).toEqual(['x1', 'x2', 'x3', 'y1', 'y2', 'y3']);
  const pairs = out.reduce((n, g) => { const k = g.filter((t) => t.startsWith('x')).length; return n + (k * (k - 1)) / 2; }, 0);
  expect(pairs).toBe(1);
});
test('first round: clubmates don’t meet; the same-group rule holds too', () => {
  const t = (id: string) => ({ id });
  const out = separateClubsInRound1([{ a: t('a1'), b: t('a2') }, { a: t('b1'), b: t('b2') }], clubOf);
  for (const p of out) expect(clubOf(p.a!.id)).not.toBe(clubOf(p.b!.id));
  const group: Record<string, string> = { a1: 'A', b2: 'A', b1: 'B', a2: 'B' };
  const kept = separateClubsInRound1([{ a: t('a1'), b: t('a2') }, { a: t('b1'), b: t('b2') }], clubOf, (x, y) => group[x] === group[y]);
  expect(kept.map((p) => [p.a!.id, p.b!.id])).toEqual([['a1', 'a2'], ['b1', 'b2']]); // the only swap would pair group mates
});
test('only for a draw', () => {
  expect(settingsRefusal('carrom', 'league', { separateClubs: true })?.error).toBe('Keeping clubs apart is for a draw — a knockout, groups or a Swiss.') // Stage 12 · CH2;
  expect(settingsRefusal('carrom', 'knockout', { separateClubs: true })).toBeNull();
});
