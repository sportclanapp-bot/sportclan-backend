/**
 * N-R7-S131 (Step 2 B11, SP-BKB-074): a basketball profile's points read 46 — the
 * 23 of the match on the player's record plus 23 from a casual match the player
 * never said In to (attributed_user_ids [], matches_played 1). A result that lists
 * whose record it changed now also decides whose career stats its events are.
 */
import fs from 'fs';
import path from 'path';
jest.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
import { onRecordMatchIds } from '../utils/matchCounts';

const ME = 'scr';
const part = (id: string, m: Record<string, unknown>) => ({ match_id: id, match: { id, status: 'completed', voided_at: null, ...m } });

test('a match the player never said In to drops out; the agreed one stays', () => {
  const parts = [
    part('agreed', { attributed_user_ids: ['org', ME, 'opp'] }),
    part('notIn', { attributed_user_ids: [] }),
    part('notInFull', { score_summary: { attributed_user_ids: ['org'] } }),
  ];
  expect(onRecordMatchIds(parts, ME)).toEqual(['agreed']);
});

test('an older result (no list) still counts, as before (N-R7-S10); a voided one never', () => {
  const parts = [part('old', {}), part('oldNull', { attributed_user_ids: null }), part('void', { voided_at: '2026-11-10', attributed_user_ids: [ME] })];
  expect(onRecordMatchIds(parts, ME)).toEqual(['old', 'oldNull']);
});

test('getSportProfile builds every sport\'s stats from those matches', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/users.controller.ts'), 'utf8');
  const parts = src.slice(src.indexOf('const partsP = allRows(() => supabase'), src.indexOf('cityP.catch('));
  expect(parts).toContain('attributed_user_ids:score_summary->attributed_user_ids');
  const stats = src.slice(src.indexOf('const { data: parts } = await partsP;'), src.indexOf("if (slug === 'cricket')"));
  expect(stats).toContain('const matchIds = onRecordMatchIds((parts ?? []) as any[], id);');
});
