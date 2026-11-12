/**
 * N-R7-S146 (Step 2 B13, SCR-T-103): a 48-team round robin has 1128 fixtures, but getBracket read
 * them unpaged and got 1000, so the app's list said 'Show 50 more fixtures · 950 left' (expected
 * '1078 left') and 128 fixtures were never shown. It now reads every fixture, 1000 at a time.
 */
import fs from 'fs';
import path from 'path';
import { selectAll } from '../utils/selectAll';

describe('N-R7-S146 · the bracket lists every fixture', () => {
  test('1128 rows read in pages of 1000 come back whole', async () => {
    const rows = Array.from({ length: 1128 }, (_, i) => ({ id: i }));
    const calls: Array<[number, number]> = [];
    const got = await selectAll<{ id: number }>(async (from, to) => { calls.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; });
    expect(got).toHaveLength(1128);
    expect(calls).toEqual([[0, 999], [1000, 1999]]);
  });
  test('getBracket pages its fixtures read, in a stable order', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
    const b = src.slice(src.indexOf('export async function getBracket'), src.indexOf('const matches = (matchesAll ?? [])'));
    expect(b).toContain('const matchesAll = await selectAll<any>((from, to) => supabase');
    expect(b).toMatch(/\.order\('scheduled_at', \{ ascending: true \}\)\s*\.order\('id', \{ ascending: true \}\)\s*\.range\(from, to\)\)/);
  });
});
