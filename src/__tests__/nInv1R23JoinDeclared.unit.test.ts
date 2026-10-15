/** N-INV1-R2-3 (launch test plan, Round 3): POST /tournaments/join dropped the amateur declaration, so a code could never enter an "amateurs only" team event. */
import fs from 'fs';
import path from 'path';

test('the join passes the declaration to the entry', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/tournaments.controller.ts'), 'utf8');
  expect(s).toContain('const { entry_code, team_id, declared_amateur } = req.body || {};');
  expect(s).toContain('enterTeam(String(tournament.id), team_id, userId, declared_amateur)');
});
