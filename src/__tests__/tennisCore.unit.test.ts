import { tennisReplay, tennisPointsDisplay, tennisSetLabel, tennisGamesPlayed } from '../utils/tennisCore';
const CORE_REL = 'utils/tennisCore.ts';
const OTHER_REPO = '../sportclan-v2';
const OTHER_CORE_REL = 'src/scoring/tennisCore.ts';
/**
 * The shared tennis rule, held to ONE fixture table in both repos.
 *
 * tennisCore.ts is byte-identical in the app and the server; this test body is
 * identical too (only the import path differs), so a change to the rule in one
 * repo that is not made in the other fails here. The server used to count each
 * POINT as a game; the app used to play 6-6 as an ordinary game.
 */
import fs from 'fs';
import path from 'path';

type S = 'A' | 'B';
const game = (s: S): S[] => [s, s, s, s];
const games = (...ws: S[]): S[] => ws.flatMap(game);
/** A set won by `w`, `wg` games to `lg`, alternating so nobody wins early. */
function set(w: S, wg: number, lg: number): S[] {
  const l: S = w === 'A' ? 'B' : 'A';
  const out: S[] = [];
  for (let i = 0; i < lg; i++) out.push(...game(w), ...game(l));
  for (let i = lg; i < wg; i++) out.push(...game(w));
  return out;
}
/** 6-6 in games, alternating. */
const sixAll = (): S[] => Array.from({ length: 6 }, () => [...game('A'), ...game('B')]).flat();
/** Tiebreak points won `wp` to `lp` by `w`, alternating, winner last. */
function tb(w: S, wp: number, lp: number): S[] {
  const l: S = w === 'A' ? 'B' : 'A';
  const out: S[] = [];
  for (let i = 0; i < lp; i++) out.push(w, l);
  for (let i = lp; i < wp; i++) out.push(w);
  return out;
}

const FIXTURES: Array<{ name: string; seq: S[]; expect: Partial<ReturnType<typeof tennisReplay>> & { label?: string } }> = [
  { name: '15-30', seq: ['A', 'B', 'B'], expect: { points: { A: 1, B: 2 }, games: { A: 0, B: 0 } } },
  { name: 'deuce, advantage, game', seq: ['A', 'A', 'A', 'B', 'B', 'B', 'A', 'B', 'A', 'A'], expect: { points: { A: 0, B: 0 }, games: { A: 1, B: 0 } } },
  { name: 'a love game', seq: games('A'), expect: { games: { A: 1, B: 0 } } },
  { name: 'a 6-4 set', seq: set('A', 6, 4), expect: { sets: [{ A: 6, B: 4 }], setsWon: { A: 1, B: 0 }, games: { A: 0, B: 0 } } },
  { name: '5-5 is not a set; 7-5 is', seq: [...Array.from({ length: 5 }, () => [...game('A'), ...game('B')]).flat(), ...games('A', 'A')], expect: { sets: [{ A: 7, B: 5 }] } },
  { name: '6-6 goes to a tiebreak', seq: sixAll(), expect: { tiebreak: true, games: { A: 6, B: 6 }, sets: [] } },
  { name: 'a tiebreak is first to 7', seq: [...sixAll(), ...tb('A', 7, 5)], expect: { tiebreak: false, sets: [{ A: 7, B: 6, tiebreak: { A: 7, B: 5 } }], setsWon: { A: 1, B: 0 } } },
  { name: 'a tiebreak is won by 2 (7-6 is not enough)', seq: [...sixAll(), ...tb('A', 6, 6), 'A'], expect: { tiebreak: true, points: { A: 7, B: 6 }, sets: [] } },
  { name: 'then 8-6 takes it', seq: [...sixAll(), ...tb('A', 6, 6), 'A', 'A'], expect: { sets: [{ A: 7, B: 6, tiebreak: { A: 8, B: 6 } }] } },
  {
    name: 'a 2-1 match, and a point after it changes nothing',
    seq: [...set('A', 6, 4), ...set('B', 6, 3), ...sixAll(), ...tb('A', 7, 5), 'B', 'B'],
    expect: { winner: 'A', setsWon: { A: 2, B: 1 }, points: { A: 0, B: 0 }, label: '6–4 · 3–6 · 7–6 (7–5)' },
  },
];

describe('tennisCore · the one rule', () => {
  test.each(FIXTURES)('$name', ({ seq, expect: want }) => {
    const got = tennisReplay(seq);
    const { label, ...shape } = want;
    expect(got).toMatchObject(shape);
    if (label) expect(got.sets.map(tennisSetLabel).join(' · ')).toBe(label);
  });

  test('display: 15 / 30 / 40, deuce, advantage, and tiebreak numbers', () => {
    expect(tennisPointsDisplay(tennisReplay(['A', 'B', 'B']))).toEqual({ a: '15', b: '30' });
    expect(tennisPointsDisplay(tennisReplay(['A', 'A', 'A', 'B', 'B', 'B'])).status).toBe('Deuce');
    expect(tennisPointsDisplay(tennisReplay(['A', 'A', 'A', 'B', 'B', 'B', 'B']))).toEqual({ a: '40', b: 'Ad', status: 'Advantage B' });
    expect(tennisPointsDisplay(tennisReplay([...sixAll(), 'A', 'A', 'B']))).toEqual({ a: '2', b: '1', status: 'Tiebreak' });
  });

  test('games played counts a tiebreak as one game (serve rotation)', () => {
    expect(tennisGamesPlayed(tennisReplay([...sixAll(), ...tb('A', 7, 0)]))).toBe(13);
  });

  test('a "1 set" match (setsToWin = 1) ends after one set, tiebreak included', () => {
    expect(tennisReplay(games('A', 'A', 'A', 'A', 'A', 'A'), 1).winner).toBe('A');
    expect(tennisReplay(games('A', 'A', 'A', 'A', 'A', 'A')).winner).toBeNull(); // best of 3 goes on
    expect(tennisReplay([...sixAll(), ...tb('B', 7, 5)], 1).winner).toBe('B');
  });

  // When both repos are checked out side by side (the dev machine), the two
  // copies must be byte-identical. Skipped elsewhere (a lone-repo CI checkout).
  const here = path.join(__dirname, '..', CORE_REL);
  const there = path.join(__dirname, '..', '..', OTHER_REPO, OTHER_CORE_REL);
  (fs.existsSync(there) ? test : test.skip)('the app and server copies are identical', () => {
    expect(fs.readFileSync(here, 'utf8')).toBe(fs.readFileSync(there, 'utf8'));
  });
});
