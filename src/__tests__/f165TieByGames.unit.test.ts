/** F165 (launch test plan, Round 1): the server's tie engine decides a rally-sport 'games' tie on games won, not points. */
import { tieOutcome, unitsFor } from '../utils/tieCore';
import { typedTiePoints } from '../utils/typedScore';
import { timedRulesLabel } from '../utils/matchRules';

const S = (key: string) => ({ key, label: key, players: 1 as const });
const spec = { rubbers: [S('MS1'), S('WS1'), { key: 'XD', label: 'XD', players: 2 as const }, S('MS2'), S('WS2')], win: 'games' as const, repeatPlayers: true };
const m = (a: string) => a.split(' ').map((g) => { const [x, y] = g.split('-').map(Number); return { a: x, b: y }; });
// A: 8 games won 11–10; B: 7 games won 11–0 (B has far more points).
const typed = [m('11-10 11-10 0-11'), m('11-10 11-10 0-11'), m('11-10 11-10 0-11'), m('11-10 0-11 0-11'), m('11-10 0-11 0-11')];
const rules = { v: 1, bestOf: 3, target: 11, winBy2: false, allGames: true, tie: spec } as any; // the app's 'UTT · 3 games, all played, golden point'

it('typed UTT tie: 8 games to 7 wins it', () => {
  expect(typedTiePoints('tabletennis', rules, spec, typed).winner).toBe('A');
});
it('the engine on the same results (units = games won)', () => {
  const res = typed.map((g, i) => ({ key: String(i), winner: (g.filter((x) => x.a > x.b).length >= 2 ? 'A' : 'B') as 'A' | 'B', sets: { A: g.map((x) => x.a), B: g.map((x) => x.b) }, units: { A: unitsFor('tabletennis', g.map((x) => x.a), g.map((x) => x.b)), B: unitsFor('tabletennis', g.map((x) => x.b), g.map((x) => x.a)) } }));
  expect(tieOutcome(spec, res).decided).toBe('A');
});
it('rules line: most games', () => {
  expect(timedRulesLabel('tabletennis', rules)).toContain('most games');
});
