/** N-R7-150 (Step 2 · Batch 8, SP-CHS-F04): a drawn third-place game decided by the organiser read 'P20 goes through' — nobody goes through from it (or from the final). */
import { chessTiebreakText } from '../utils/chessRules';

test('the third-place game and the final say what was won', () => {
  expect(chessTiebreakText('P20', 'organiser', null, 'third_place')).toBe("P20 takes third place (organiser's call)");
  expect(chessTiebreakText('P20', 'armageddon', 'draw', 'third_place')).toBe('P20 takes third place on the Armageddon draw');
  expect(chessTiebreakText('P17', 'organiser', null, 'final')).toBe("P17 wins the final (organiser's call)");
  expect(chessTiebreakText('P17', 'armageddon', 'white', 'final')).toBe('P17 won the Armageddon');
});
test('an earlier round still goes through', () => {
  expect(chessTiebreakText('X', 'organiser')).toBe("X goes through (organiser's call)");
  expect(chessTiebreakText('X', 'armageddon', 'draw')).toBe('X went through on the Armageddon draw');
});
