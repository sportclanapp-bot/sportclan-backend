/**
 * Session 3 of MATCH_CREATE_TEST_PLAN (device, 2026-09-25).
 * F-29: a line-up batch with one player on both sides was silently "deduped"
 *   (last wins) — the saved line-up differed from the one on screen.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));

import { lineupSideConflict } from '../controllers/matches.controller';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
const fn = (name: string) => {
  const i = src.indexOf(`export async function ${name}(`);
  return src.slice(i, src.indexOf('\nexport ', i + 10));
};

describe('F-29 · lineupSideConflict', () => {
  test('the same player on both sides is named', () => {
    expect(lineupSideConflict([
      { user_id: 'a', team_side: 'A' }, { user_id: 'b', team_side: 'A' },
      { user_id: 'a', team_side: 'B' },
    ])).toBe('a');
  });
  test('an exact repeat is not a conflict (still just deduped)', () => {
    expect(lineupSideConflict([{ user_id: 'a', team_side: 'A' }, { user_id: 'a', team_side: 'A' }])).toBeNull();
  });
  test('a normal line-up passes; junk rows are ignored', () => {
    expect(lineupSideConflict([{ user_id: 'a', team_side: 'A' }, { user_id: 'b', team_side: 'B' }, null, {}])).toBeNull();
  });
  test('addParticipants refuses it before the dedupe and the upsert', () => {
    const body = fn('addParticipants');
    const check = body.indexOf('lineupSideConflict(participants as any[])');
    expect(check).toBeGreaterThan(0);
    expect(body).toContain("code: 'PLAYER_ON_BOTH_SIDES'");
    expect(check).toBeLessThan(body.indexOf('const byUser = new Map'));
    expect(check).toBeLessThan(body.indexOf(".upsert(rows"));
  });
});
