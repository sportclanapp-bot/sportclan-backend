/**
 * N-R7-S137 (Step 2 B12, SP-HOC-044, server side of N-R7-321): getBracket sent a
 * walkover's stale live score. A hockey knockout semi abandoned at 1–0 and given
 * to the side behind kept score_summary A 1 B 0 (walkover: true) — the sport and
 * tournament have no walkover score — so the bracket card read '1 / ✓ 0'.
 * Expected: no score for such a walkover; a walkover with a score keeps it.
 */
import fs from 'fs';
import path from 'path';
import { walkoverScoreless } from '../utils/walkoverScore';
import type { MatchRules } from '../utils/matchRules';

const R = {} as MatchRules;

describe('N-R7-S137 · a walkover with no walkover score has no score', () => {
  test('hockey without the setting: scoreless; football (3–0) or a set score: scored', () => {
    expect(walkoverScoreless('walkover', 'hockey', R, {})).toBe(true);
    expect(walkoverScoreless('walkover', 'hockey', R, { walkoverScore: 5 })).toBe(false);
    expect(walkoverScoreless('walkover', 'football', R, {})).toBe(false);
    expect(walkoverScoreless(undefined, 'hockey', R, {})).toBe(false);
    expect(walkoverScoreless('awarded', 'hockey', R, {})).toBe(false);
  });
  test('getBracket sends no score for it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
    const b = src.slice(src.indexOf('export async function getBracket'), src.indexOf('export async function joinByCode'));
    expect(b).toMatch(/const noScore = walkoverScoreless\(decided\.decided_by, slug, \(m as any\)\.rules \?\? \{\}, \(tournament as \{ settings\?: unknown \}\)\.settings\);/);
    expect(b).toContain('score_a: noScore ? null :');
    expect(b).toContain('score_b: noScore ? null :');
  });
});
