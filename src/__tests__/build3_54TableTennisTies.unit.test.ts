/** BUILD 3.54 · table tennis team ties (Corbillon 5, Swaythling 9) — the server splits and decides them too. */
import { rulesRefusal, setConfigOf, standardRules, winsToWin } from '../utils/matchRules';
import { rollupTie } from '../controllers/scoring.controller';

test('the rule', () => {
  expect(rulesRefusal('tabletennis', { ...standardRules('tabletennis'), rubbers: 9 })).toBeNull();
  expect(rulesRefusal('tabletennis', { ...standardRules('tabletennis'), rubbers: 7 })?.field).toBe('rubbers');
  expect(winsToWin({ ...standardRules('tabletennis'), rubbers: 5 })).toBe(3);
});
test('a Corbillon tie of 1-game rubbers: 3 wins it', () => {
  const g = (s: string) => Array.from({ length: 11 }, () => ({ event_type: 'score', payload: { team_side: s, value: 1 } }));
  const cfg = setConfigOf({ ...standardRules('tabletennis'), bestOf: 1 });
  const side = (p: { team_side?: string }) => (p.team_side === 'B' ? 'B' : 'A') as 'A' | 'B';
  expect(rollupTie(cfg, 5, [...g('A'), ...g('B'), ...g('A')], side)).toMatchObject({ rubbersA: 2, rubbersB: 1, decided: null, rubber: 4 });
  expect(rollupTie(cfg, 5, [...g('A'), ...g('B'), ...g('A'), ...g('A')], side).decided).toBe('A');
});
test('the summary uses the tie rollup for any sport with rubbers', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const src: string = require('fs').readFileSync(require('path').join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain('if (rules.rubbers) { // BUILD 3.54: table tennis ties too');
});
