/**
 * N-R7-S120 (Batch 10, SPP2-VOL-089): an undone misconduct note read
 * "Lions Captain undid: violation" in the scoring log — the raw note kind.
 * The undo now says which sanction it was, in the timeline's words, and a
 * volleyball line-up / libero / Super Point note reads in words too.
 */
import { describeEvent, LogContext } from '../utils/editLog';

const ctx = (sport: string): LogContext => ({ sport, teamA: 'Lions', teamB: 'Tigers' });

describe('N-R7-S120 · notes in the scoring log read in words', () => {
  test('a volleyball delay warning', () => {
    expect(describeEvent('note', { kind: 'violation', team_side: 'B', offence: 'time', penalty: 'warning', n: 1 }, ctx('volleyball')))
      .toBe('misconduct — Tigers · delay · warning');
  });
  test('a player sanction names the player', () => {
    expect(describeEvent('note', { kind: 'violation', team_side: 'A', offence: 'conduct', penalty: 'expel', n: 3, player_name: 'Ravi' }, ctx('volleyball')))
      .toBe('misconduct — Ravi (Lions) · unsportsmanlike conduct · expulsion');
  });
  test('volleyball court notes', () => {
    expect(describeEvent('note', { kind: 'rotation', team_side: 'B', set: 2, slots: [{ name: 'Asha' }] }, ctx('volleyball'))).toBe('Tigers line-up for set 2: I Asha');
    expect(describeEvent('note', { kind: 'libero', team_side: 'A', libero: { name: 'Nikhil' } }, ctx('volleyball'))).toBe('Libero Nikhil in — Lions');
    expect(describeEvent('note', { kind: 'super_point', team_side: 'A' }, ctx('volleyball'))).toBe('Super Point called — Lions');
  });
  test('never the raw kind', () => {
    for (const sport of ['volleyball', 'badminton', 'tabletennis', 'carrom', 'chess']) {
      expect(describeEvent('note', { kind: 'violation', team_side: 'A', offence: 'conduct', penalty: 'warning', n: 1 }, ctx(sport))).not.toMatch(/^violation$/);
    }
  });
  test('notes already in words are unchanged', () => {
    expect(describeEvent('note', { kind: 'warmup' }, ctx('tabletennis'))).toBe('warm-up');
    expect(describeEvent('note', { kind: 'buzzer' }, ctx('carrom'))).toBe('time called');
  });
});
