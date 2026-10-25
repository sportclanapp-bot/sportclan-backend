/**
 * N-R7-S64 (Step 2 · Batch 3, SP-FBL-180) · a knockout final level after extra time and won on
 * penalties: the bracket answer gave only the goals (1 / 1), so the champion card read 'beat Lions
 * 1–1 in the final' and the bracket card showed no pens and no extra time. Each played fixture now
 * carries its shoot-out ({ A, B }) and whether it went past regulation (extra_time).
 */
import fs from 'fs';
import path from 'path';
import { fixtureFinish } from '../controllers/tournaments.controller';

const ss = (periods: number, shootout?: { A: number; B: number }) => ({ A: { goals: 1, score: 1 }, B: { goals: 1, score: 1 }, periods: Array.from({ length: periods }, () => ({ A: 0, B: 0 })), ...(shootout ? { shootout } : {}) });

describe('N-R7-S64 · pens and extra time reach the bracket', () => {
  test('1–1 after extra time, 4–5 on pens', () => {
    expect(fixtureFinish('football', { status: 'completed', score_summary: ss(4, { A: 4, B: 5 }), rules: null })).toEqual({ shootout: { A: 4, B: 5 }, extra_time: true });
  });
  test('straight to pens after 90 minutes', () => {
    expect(fixtureFinish('football', { status: 'completed', score_summary: ss(2, { A: 3, B: 2 }), rules: null })).toEqual({ shootout: { A: 3, B: 2 } });
  });
  test('won in normal time, or not played: nothing extra', () => {
    expect(fixtureFinish('football', { status: 'completed', score_summary: ss(2), rules: null })).toEqual({});
    expect(fixtureFinish('football', { status: 'scheduled', score_summary: null, rules: null })).toEqual({});
  });
  test('a walkover is not a shoot-out', () => {
    expect(fixtureFinish('football', { status: 'completed', score_summary: { ...ss(0, { A: 3, B: 0 }), walkover: true }, rules: null, result_type: 'walkover' })).toEqual({});
  });
  test('getBracket sends them', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
    const b = src.slice(src.indexOf('export async function getBracket'), src.indexOf('export async function joinByCode'));
    expect(b).toContain('...fixtureFinish(slug, m as any),');
    expect(b).toMatch(/\.select\('id, name, format, settings, sport_id'\)/);
  });
});
