/**
 * N-R7-92 (SPP1-TTN-017) · the scoring edit log names a warm-up note 'warm-up', not the raw kind
 * 'warmup' ('deleted: warmup' on the phone); a medical time-out reads 'medical time-out'.
 */
import { describeEvent, LogContext } from '../utils/editLog';

const ctx: LogContext = { sport: 'table-tennis', teamA: 'Asha', teamB: 'Bina' };

describe('N-R7-92 · note kinds in words', () => {
  test('warm-up', () => expect(describeEvent('note', { kind: 'warmup' }, ctx)).toBe('warm-up'));
  test('medical time-out', () => expect(describeEvent('note', { kind: 'medical_timeout' }, ctx)).toBe('medical time-out'));
  test('the others keep their words', () => {
    expect(describeEvent('note', { kind: 'expedite' }, ctx)).toBe('expedite');
    expect(describeEvent('note', { kind: 'violation' }, ctx)).toBe('violation');
    expect(describeEvent('note', { kind: 'clock_pause' }, ctx)).toBe('clock pause');
  });
});
