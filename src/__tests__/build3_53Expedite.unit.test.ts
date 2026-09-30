/** BUILD 3.53 · the expedite rule: table tennis only, not at 9-all; the timeline says it; it scores nothing. */
import { sportCommentary } from '../utils/commentary';
import { rollupSets } from '../controllers/scoring.controller';
import { setConfigOf, standardRules } from '../utils/matchRules';

test('the timeline line', () => {
  expect(sportCommentary('note', { kind: 'expedite' }, { sport: 'tabletennis', teamA: 'Loops', teamB: 'Chops', period: 1 } as never))
    .toBe('⏱ Expedite rule — serve alternates; the receiver wins on the 13th return');
});
test('a note scores nothing', () => {
  const r = rollupSets(setConfigOf(standardRules('tabletennis')), [{ event_type: 'note', payload: { kind: 'expedite' } }], () => 'A');
  expect([r.curA, r.curB, r.setScoresA.length]).toEqual([0, 0, 0]);
});
test('checked before it is stored', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const src: string = require('fs').readFileSync(require('path').join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain("if (slug !== 'tabletennis') return refuse(400, { error: 'The expedite rule is for table tennis.', code: 'BAD_NOTE' });");
  expect(src).toContain("code: 'EXPEDITE_TOO_LATE'");
});
