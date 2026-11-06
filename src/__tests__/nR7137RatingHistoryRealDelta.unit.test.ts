/**
 * N-R7-137 (Step 2, Batch 8 · OBS-A2-2): finalize_match stored the Elo delta asked for in
 * rating_history, not the change made. At the 100 floor (105 loses 8 → 100) the row said -8: the
 * profile read "after 1 rated match (-8)" and a void reversed -8 (→ 108). Migration 161 recreates
 * finalize_match to store new - old and corrects the floor rows already written (not voided ones).
 * The latest finalize_match in the migrations must be 161's, and it must store new - old.
 */
import fs from 'fs';
import path from 'path';

const dir = path.join(__dirname, '../../supabase/migrations');
const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const defs = files.filter((f) => /CREATE OR REPLACE FUNCTION (public\.)?finalize_match\b/i.test(fs.readFileSync(path.join(dir, f), 'utf8')));

test('the latest finalize_match stores the real change in rating_history', () => {
  const last = defs[defs.length - 1]!;
  expect(last).toBe('161_rating_history_real_delta.sql');
  const sql = fs.readFileSync(path.join(dir, last), 'utf8');
  const ins = sql.slice(sql.indexOf('INSERT INTO rating_history'));
  expect(ins).toMatch(/VALUES \(v_uid, v_sport, p_match_id, v_old, v_new, v_new - v_old\);/);
  expect(sql).toMatch(/v_new := GREATEST\(100, v_old \+ v_delta\);/); // the floor itself is unchanged
});

test('161 corrects only floor rows of matches that are not voided', () => {
  const sql = fs.readFileSync(path.join(dir, '161_rating_history_real_delta.sql'), 'utf8');
  const upd = sql.slice(sql.indexOf('UPDATE public.rating_history'));
  expect(upd).toMatch(/SET delta = h\.new_rating - h\.old_rating/);
  expect(upd).toMatch(/h\.new_rating = 100/);
  expect(upd).toMatch(/voided_at IS NOT NULL/);
});
