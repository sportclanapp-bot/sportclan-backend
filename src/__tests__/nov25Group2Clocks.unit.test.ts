/**
 * Fix list 25 Nov 2026 · group 2 on the server: item 36 the physical-clock rule, item 39 no clocks
 * nobody used in a chess summary, item 46 the timeline words of a cricket clock stop.
 */
import fs from 'fs';
import path from 'path';
import { chessPhysicalClock, chessSpeedOf, normalizeRules, rulesRefusal, standardRules, tournamentRulesRefusal } from '../utils/matchRules';
import { sportCommentary } from '../utils/commentary';
import { inningsClock } from '../utils/cricketRules';

describe('item 36', () => {
  it('the rule is accepted, kept and leaves the rating class alone; rules without it are stored as before', () => {
    const r = { ...standardRules('chess'), baseMinutes: 15, incrementSeconds: 10, physicalClock: true };
    expect(rulesRefusal('chess', r)).toBeNull();
    expect(chessPhysicalClock(normalizeRules('chess', r))).toBe(true);
    expect(chessSpeedOf(normalizeRules('chess', r))).toBe('Rapid');
    expect(normalizeRules('chess', { baseMinutes: 15 })).not.toHaveProperty('physicalClock');
    expect(rulesRefusal('chess', { ...r, physicalClock: 1 })?.field).toBe('physicalClock');
    expect(tournamentRulesRefusal('chess', { default: { v: 1, physicalClock: true }, final: { v: 1, physicalClock: false } })).toBeNull();
  });
});

describe('item 39 · the chess summary', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  it('a clock nobody used is null: no arbiter time, no 0:00 on a timeout', () => {
    expect(src).toContain("const clockUsed = !chessPhysicalClock(rulesOf('chess', match as never)) && events.some(");
    expect(src).toContain('if (!clockUsed) { chessClockWhite = null; chessClockBlack = null; chessBonus.A = 0; chessBonus.B = 0; }');
    expect(src.match(/if \(clockUsed && chessReason === 'timeout'/g)).toHaveLength(2);
  });
});

describe('item 46', () => {
  it('the shared innings clock stops and restarts', () => {
    const T = Date.parse('2026-11-25T10:00:00Z'); const at = (m: number) => new Date(T + m * 60000).toISOString();
    const log = [{ event_type: 'ball', payload: { team_side: 'A' }, created_at: at(0) }, { event_type: 'note', payload: { kind: 'clock_pause', reason: 'Rain' }, created_at: at(10) }];
    expect(inningsClock(log, 'A', 60, T + 40 * 60000)).toMatchObject({ elapsed: 10, paused: true });
  });
  it('the timeline says why play stopped, in cricket only; the football clock keeps its words', () => {
    const ctx = (sport: string) => ({ sport, teamA: 'Lions', teamB: 'Tigers', period: 0 }) as never;
    expect(sportCommentary('note', { kind: 'clock_pause', reason: 'Rain' }, ctx('cricket'))).toBe('⏸ Play stopped · Rain');
    expect(sportCommentary('note', { kind: 'clock_pause' }, ctx('cricket'))).toBe('⏸ Play stopped');
    expect(sportCommentary('note', { kind: 'clock_resume' }, ctx('cricket'))).toBe('▶ Play restarted');
    expect(sportCommentary('note', { kind: 'clock_pause', reason: 'Rain' }, ctx('football'))).toBe('⏸ Clock stopped');
  });
});
