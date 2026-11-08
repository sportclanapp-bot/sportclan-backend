/**
 * N-R7-201 (Step 2 Batch 9, SPP1-CRM-035) · the carrom scoring log said an undone White slam as
 * 'undid: Bina +12, 3–12 → 3–0' (no 'slam') and an undone time call as 'undid: buzzer, …'. A slam
 * board names its slam ('Bina White slam +12'), and the buzzer note reads 'time called', the pad's
 * own words (⏱ TIME CALLED) — for every sport that calls time.
 */
import { describeEvent, editLine, LogContext } from '../utils/editLog';

const ctx: LogContext = { sport: 'carrom', teamA: 'Asha', teamB: 'Bina' };

describe('N-R7-201 · carrom slam and time called in words', () => {
  test('a slam board says which slam', () => {
    expect(describeEvent('score', { kind: 'board', slam: 'white', value: 12, team_side: 'B' }, ctx)).toBe('Bina White slam +12');
    expect(describeEvent('score', { kind: 'board', slam: 'black', queen: true, value: 9, team_side: 'A' }, ctx)).toBe('Asha Black slam +9');
  });
  test('a plain board is unchanged', () => {
    expect(describeEvent('score', { kind: 'board', value: 4, team_side: 'A' }, ctx)).toBe('Asha +4');
  });
  test('time called', () => {
    expect(describeEvent('note', { kind: 'buzzer' }, ctx)).toBe('time called');
    expect(describeEvent('note', { kind: 'buzzer', typed: true }, { ...ctx, sport: 'pickleball' })).toBe('time called');
  });
  test('the undo lines read in plain words', () => {
    const row = (p: Record<string, unknown>, type: string) => ({
      id: 'x', action: 'undo', changed_by: 'u', created_at: '2026-11-09',
      old_payload: { event_type: type, payload: p },
      score_before: { A: { score: 0, points: 3 }, B: { score: 0, points: 12 } },
      score_after: { A: { score: 0, points: 3 }, B: { score: 0, points: 0 } },
    });
    expect(editLine(row({ kind: 'board', slam: 'white', value: 12, team_side: 'B' }, 'score'), 'Kiran', ctx)).toBe('Kiran undid: Bina White slam +12, 3–12 → 3–0');
    expect(editLine(row({ kind: 'buzzer' }, 'note'), 'Kiran', ctx)).toMatch(/^Kiran undid: time called, /);
  });
});
