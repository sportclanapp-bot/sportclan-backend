/** N-SPP2-5 (launch test plan, Round 3): the bracket says how a fixture was decided when it wasn't played out, so the champion card doesn't read 'beat X 0–0 in the final'. */
import fs from 'fs';
import path from 'path';
import { decidedBy } from '../controllers/tournaments.controller';

test('walkover, default, award — else nothing', () => {
  expect(decidedBy({ result_type: 'default', score_summary: { A: { score: 0 }, B: { score: 0 } } })).toBe('default');
  expect(decidedBy({ result_type: null, score_summary: { walkover: true } })).toBe('walkover');
  expect(decidedBy({ result_type: 'awarded' })).toBe('awarded');
  expect(decidedBy({ result_type: 'decisive', score_summary: {} })).toBeNull();
  expect(decidedBy({ result_type: 'retired', score_summary: {} })).toBeNull(); // played, with a real score
});
test('the bracket reads result_type and sends it', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
  expect(s).toContain('loser_next_match_id, loser_next_slot, result_type\')');
  expect(s).toContain('...(decidedBy(m as any) ? { decided_by: decidedBy(m as any) } : {}),');
});
