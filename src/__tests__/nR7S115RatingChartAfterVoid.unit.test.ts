/**
 * N-R7-S115 (OBS-P6-1, Step 2 B8): after an earlier rated game was voided, the profile headline
 * read 1242 (the void took its +11 off) but the chart's last bar still read 'rating 1253, +10'.
 * The rating history shows each kept game less the delta of every voided game played before it
 * and voided after it; a game rated after the void was already rated from the lowered rating.
 */
import fs from 'fs';
import path from 'path';
import { shiftForVoided, type HistoryRow } from '../utils/ratingHistoryShift';

const T = (h: number) => new Date(Date.UTC(2026, 10, 7, h)).toISOString();
const row = (o: number, n: number, h: number, voidedAt: number | null = null): HistoryRow =>
  ({ old_rating: o, new_rating: n, delta: Math.round((n - o) * 100) / 100, created_at: T(h), voided_at: voidedAt == null ? null : T(voidedAt) });

test("P6's data: a game played before the void and voided after it reads 1241.57 +10.31 (headline 1241.57 → '1242')", () => {
  const rows = [
    row(1200, 1216, 1), row(1216, 1198.53, 2, 3), // voided at once: the next game was rated from 1216
    row(1216, 1231.26, 4), row(1231.26, 1242.24, 5, 7), row(1242.24, 1252.55, 6), // 6 was rated before 5 was voided
    row(1241.57, 1251.92, 8, 9),
  ];
  expect(shiftForVoided(rows)).toEqual([
    { old_rating: 1200, new_rating: 1216, delta: 16, created_at: T(1) },
    { old_rating: 1216, new_rating: 1231.26, delta: 15.26, created_at: T(4) },
    { old_rating: 1231.26, new_rating: 1241.57, delta: 10.31, created_at: T(6) },
  ]);
});

test('nothing voided: rows unchanged; voided rows never shown; the last 10 kept games', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(1200 + i, 1201 + i, i + 1, i === 0 ? 20 : null));
  const out = shiftForVoided(rows);
  expect(out).toHaveLength(10);
  expect(out[9]).toEqual({ old_rating: 1210, new_rating: 1211, delta: 1, created_at: T(12) });
  expect(out[0]!.new_rating).toBe(1202); // game 3: 1203 less the +1 voided later
  expect(shiftForVoided([row(1200, 1210, 1)])).toEqual([{ old_rating: 1200, new_rating: 1210, delta: 10, created_at: T(1) }]);
});

test('a voided loss lifts the later games; the floor of 100 holds', () => {
  expect(shiftForVoided([row(1250, 1240, 1, 5), row(1240, 1250, 2)])[0]).toMatchObject({ old_rating: 1250, new_rating: 1260 });
  expect(shiftForVoided([row(100, 160, 1, 5), row(160, 150, 2)])[0]).toMatchObject({ old_rating: 100, new_rating: 100 });
});

test('the rating-history route reads every row (voided ones too) and shifts them', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/users.controller.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function getRatingHistory'), src.indexOf('export async function getChessRatings'));
  expect(fn).toMatch(/selectAll<any>\(\(from, to\) => supabase\s*\.from\('rating_history'\)/);
  expect(fn).not.toMatch(/\.is\('match\.voided_at', null\)/);
  expect(fn).toMatch(/shiftForVoided\(\(data \?\? \[\]\)\.map\(\(\{ match, \.\.\.row \}: any\) => \(\{ \.\.\.row, voided_at: match\?\.voided_at \?\? null \}\)\), 10\)/);
});
