/**
 * Session 3 of MATCH_CREATE_TEST_PLAN (device, 2026-09-25).
 * F-29: a line-up batch with one player on both sides was silently "deduped"
 *   (last wins) — the saved line-up differed from the one on screen.
 * F-33: a player in a ranked match could self-assign as its umpire, and so
 *   score their own ranked result (decision: refused on ranked matches only).
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

describe('F-33 · selfAssignUmpire', () => {
  const body = fn('selfAssignUmpire');
  test('reads is_ranked and both team ids', () => {
    expect(body).toContain(".select('id, umpire_id, created_by, status, team_a_name, team_b_name, is_ranked, team_a_id, team_b_id')");
  });
  test('a player (line-up or either roster) is refused on a ranked match, before the write', () => {
    const guard = body.indexOf('if (match.is_ranked) {');
    expect(guard).toBeGreaterThan(0);
    expect(body.slice(guard, guard + 400)).toContain('viewerCanPlay(match, userId,');
    expect(body).toContain("code: 'UMPIRE_IS_PLAYER'");
    expect(guard).toBeLessThan(body.indexOf(".update({ umpire_id: userId"));
  });
  test('a casual match is not affected', () => {
    expect(body.match(/viewerCanPlay\(/g)?.length).toBe(1);
  });
});
