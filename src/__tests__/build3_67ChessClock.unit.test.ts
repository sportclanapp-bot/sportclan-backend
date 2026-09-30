/** BUILD 3.67 · any chess clock in range; the stored format carries the worked-out category. */
import { chessClockLabel, legacyFromRules, rulesRefusal, standardRules } from '../utils/matchRules';

test('range and category', () => {
  expect(rulesRefusal('chess', { ...standardRules('chess'), baseMinutes: 45, incrementSeconds: 15 })).toBeNull();
  expect(rulesRefusal('chess', { ...standardRules('chess'), baseMinutes: 121, incrementSeconds: 0 })?.field).toBe('baseMinutes');
  expect(legacyFromRules('chess', { ...standardRules('chess'), baseMinutes: 45, incrementSeconds: 15 }).format).toBe('Classical · 45+15');
  expect(chessClockLabel(10)).toBe('Blitz'); // 30 Sep: FIDE — 10 minutes or less is blitz
  expect(chessClockLabel(10, 1)).toBe('Rapid');
});
