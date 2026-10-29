/**
 * N-R7-S4 re-run (SPP2-FOO-041, Batch 3 F9): with 'keep the same club apart', 1 of 6 random KO8
 * draws still put the two clubmates in one half — both were the higher seed (a side) of their
 * first-round pair, and only lower seeds (b sides) were ever swapped. A higher seed may now swap
 * with another of its own seeding pot (3–4, 5–8, …; seeds 1 and 2 never move) holding the same
 * bye, so seeding is kept and the clubmates can meet only in the final.
 */
import { separateClubsInRound1 } from '../utils/clubSeparation';

const t = (id: string) => ({ id });
// The standard KO8 order: 1v8, 4v5 | 2v7, 3v6 (pairs 0–1 feed one semi, 2–3 the other).
const draw = () => [{ a: t('s1'), b: t('s8') }, { a: t('s4'), b: t('s5') }, { a: t('s2'), b: t('s7') }, { a: t('s3'), b: t('s6') }];
const seedOf = (id: string) => Number(id.slice(1));
const half = (out: Array<{ a: { id: string } | null; b: { id: string } | null }>, id: string) => out.findIndex((p) => p.a?.id === id || p.b?.id === id) < 2 ? 0 : 1;

test.each([['s1', 's4'], ['s2', 's3'], ['s4', 's1']])('clubmates %s and %s (both higher seeds) end in opposite halves', (x, y) => {
  const club = (id: string) => (id === x || id === y ? 'Kolhapur FC' : `c-${id}`);
  const out = separateClubsInRound1(draw(), club, () => false, seedOf);
  expect(half(out, x)).not.toBe(half(out, y));
  // seeding kept: seeds 1 and 2 stay put, each pair's higher seed is still from the top four
  expect(out[0]!.a!.id).toBe('s1');
  expect(out[2]!.a!.id).toBe('s2');
  expect(out.map((p) => seedOf(p.a!.id)).every((s) => s <= 4)).toBe(true);
});

test('a higher seed never takes another pair’s bye', () => {
  // 5 entries: byes for seeds 1, 2, 3; seed 4 plays seed 5.
  const five = [{ a: t('s1'), b: null }, { a: t('s4'), b: t('s5') }, { a: t('s2'), b: null }, { a: t('s3'), b: null }];
  const club = (id: string) => (id === 's1' || id === 's4' ? 'K' : `c-${id}`);
  const out = separateClubsInRound1(five, club, () => false, seedOf);
  expect(out[1]).toEqual({ a: t('s4'), b: t('s5') });
});
