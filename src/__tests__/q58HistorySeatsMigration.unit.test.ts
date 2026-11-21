/**
 * Q58 (Dipak, 21 Nov 2026: B) · N-R7-S87, migration 168 (lane A's SQL request): a named official seat
 * (assistant referee, fourth official…) lists the match in that person's history with its seat; only
 * the main official counts it in officiated_count.
 */
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/168_history_official_seats.sql'), 'utf8').replace(/--.*$/gm, '');
test('a live named seat is in `mine`, with its role as the seat', () => {
  expect(sql).toMatch(/SELECT mo\.match_id, NULL, 0, mo\.role FROM match_officials mo WHERE mo\.user_id = p_user AND mo\.removed_at IS NULL/);
  expect(sql).toMatch(/ORDER BY id, played DESC, \(seat IS NULL\) DESC, seat/);
});
test('only the main official is counted, and a page item says the seat', () => {
  expect(sql).toMatch(/'officiated_count', \(SELECT count\(\*\) FROM hist WHERE played = 0 AND seat IS NULL AND status = 'completed'/);
  expect(sql).toContain("'seat', seat)");
});
test('replaces the function only; nothing removed', () => {
  expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
});
