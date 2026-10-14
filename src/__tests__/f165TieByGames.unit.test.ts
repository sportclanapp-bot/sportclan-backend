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

// F165, found on the phone (14 Oct): the hero said 8–7 but the stored result read 'won 157–88'
// — the server's tie score (and so its result line) was still the points. A games tie scores games.
import { rollupTieSpec } from '../controllers/scoring.controller';
it('the server’s tie score is games won: 8–7, not 88–157', () => {
  const events = typed.flatMap((sets) => sets.flatMap((g) => {
    const out: { event_type: string; payload: { team_side: 'A' | 'B' } }[] = [];
    // play each game's points so the winner of the game scores its last point
    const w = g.a > g.b ? 'A' : 'B'; const l = w === 'A' ? 'B' : 'A';
    const lose = Math.min(g.a, g.b), win = Math.max(g.a, g.b);
    for (let i = 0; i < lose; i++) out.push({ event_type: 'score', payload: { team_side: l } });
    for (let i = 0; i < win; i++) out.push({ event_type: 'score', payload: { team_side: w } });
    return out;
  }));
  const t = rollupTieSpec('table-tennis', rules, spec, events, (p) => p.team_side);
  expect(t.tie.decided).toBe('A');
  expect([t.scoreA, t.scoreB]).toEqual([8, 7]);
  expect([t.tie.unitsA, t.tie.unitsB]).toEqual([88, 157]); // the points stay recorded
});
