/**
 * N-R7-S115 (OBS-P6-1, Step 2 B8): after an earlier rated game was voided, the profile headline
 * read 1242 (the void took its +11 off) but the chart's last bar still read 'rating 1253, +10'.
 * The rating history shows each kept game less every earlier voided game's delta.
 */
import fs from 'fs';
import path from 'path';
import { shiftForVoided, type HistoryRow } from '../utils/ratingHistoryShift';

const row = (o: number, n: number, voided = false, t = '2026-11-07T00:00:00Z'): HistoryRow => ({ old_rating: o, new_rating: n, delta: n - o, created_at: t, voided });

test('a later game reads its rating less the voided game before it (P6: 1253 +10 → 1242 +10)', () => {
  const rows = [row(1200, 1232, false, 't1'), row(1232, 1243, true, 't2'), row(1243, 1253, false, 't3')];
  expect(shiftForVoided(rows)).toEqual([
    { old_rating: 1200, new_rating: 1232, delta: 32, created_at: 't1' },
    { old_rating: 1232, new_rating: 1242, delta: 10, created_at: 't3' },
  ]);
});

test('nothing voided: rows unchanged; voided rows never shown; last 10 kept games', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(1200 + i, 1201 + i, i === 0, `t${i}`));
  const out = shiftForVoided(rows);
  expect(out).toHaveLength(10);
  expect(out[9]).toEqual({ old_rating: 1210, new_rating: 1211, delta: 1, created_at: 't11' });
  expect(out[0]!.new_rating).toBe(1202); // t2: 1203 less the voided +1
  expect(shiftForVoided([row(1200, 1210)])).toEqual([{ old_rating: 1200, new_rating: 1210, delta: 10, created_at: '2026-11-07T00:00:00Z' }]);
});

test('a voided loss lifts the later games; the floor of 100 holds', () => {
  expect(shiftForVoided([row(1250, 1240, true), row(1240, 1250)])[0]).toMatchObject({ old_rating: 1250, new_rating: 1260 });
  expect(shiftForVoided([row(100, 160, true), row(160, 150)])[0]).toMatchObject({ old_rating: 100, new_rating: 100 });
});

test('the rating-history route reads every row (voided ones too) and shifts them', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/users.controller.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function getRatingHistory'), src.indexOf('export async function getChessRatings'));
  expect(fn).toMatch(/selectAll<any>\(\(from, to\) => supabase\s*\.from\('rating_history'\)/);
  expect(fn).not.toMatch(/\.is\('match\.voided_at', null\)/);
  expect(fn).toMatch(/shiftForVoided\(/);
});
