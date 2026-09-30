/** BUILD 3.49 · a badminton team tie: rubbers of best-of games; the tie to the rubber majority. */
import { rulesRefusal, setConfigOf, standardRules, winsToWin } from '../utils/matchRules';
import { bestOfState, rollupTie } from '../controllers/scoring.controller';
import { scorePush } from '../utils/scorePush';

const side = (p: { team_side?: string }) => (p.team_side === 'B' ? 'B' : 'A') as 'A' | 'B';
const game = (s: string) => Array.from({ length: 15 }, () => ({ event_type: 'score', payload: { team_side: s, value: 1 } }));
const rubber = (s: string) => [...game(s), ...game(s)];
const cfg = setConfigOf(standardRules('badminton')); // best of 3 games, 15 cap 21

test('the rule', () => {
  expect(rulesRefusal('badminton', { ...standardRules('badminton'), rubbers: 5 })).toBeNull();
  expect(rulesRefusal('badminton', { ...standardRules('badminton'), rubbers: 2 })?.field).toBe('rubbers');
  expect(winsToWin({ ...standardRules('badminton'), rubbers: 3 })).toBe(2);
});

test('rubbers split the same events as the app; no dead rubbers', () => {
  const one = rollupTie(cfg, 3, rubber('A'), side);
  expect(one).toMatchObject({ rubbersA: 1, rubbersB: 0, rubber: 2, gamesA: 0, decided: null });
  expect(one.results).toEqual([{ A: 2, B: 0, winner: 'A' }]);
  const done = rollupTie(cfg, 3, [...rubber('A'), ...rubber('B'), ...rubber('A'), ...game('B')], side);
  expect(done).toMatchObject({ rubbersA: 2, rubbersB: 1, rubber: 3, decided: 'A' });
  expect(done.setScoresA).toEqual([15, 15, 0, 0, 15, 15]); // every game; the extra one after the tie ignored
  expect(rollupTie(cfg, 3, [...rubber('B'), ...rubber('B')], side).decided).toBe('B');
  expect(rollupTie(cfg, 5, [...rubber('B'), ...rubber('B')], side).decided).toBeNull();
  const mid = rollupTie(cfg, 3, [...rubber('A'), ...game('B'), ...game('A').slice(0, 4)], side);
  expect(mid).toMatchObject({ rubber: 2, gamesA: 0, gamesB: 1, curA: 4, curB: 0 });
});

test('completion reads rubbers: 2 of 3 decides it', () => {
  const m = { format: 'bo3', rules: { ...standardRules('badminton'), rubbers: 3 } };
  expect(bestOfState('badminton', { A: { score: 1 }, B: { score: 1 } }, m)?.decided).toBe(false);
  expect(bestOfState('badminton', { A: { score: 2 }, B: { score: 1 } }, m)).toMatchObject({ needed: 2, decided: true, leader: 'A' });
  expect(bestOfState('badminton', { A: { score: 2 }, B: { score: 0 } }, { format: 'bo5', rules: { ...standardRules('badminton'), bestOf: 5, rubbers: 5 } })?.decided).toBe(false);
});

test('the push names the rubber when one ends', () => {
  const prev = { A: { sets: [15], points: 14 }, B: { sets: [0], points: 0 }, rubbers: [] };
  const now = { A: { sets: [15, 15], points: 0, score: 1 }, B: { sets: [0, 0], points: 0, score: 0 }, rubbers: [{ A: 2, B: 0, winner: 'A' as const }] };
  expect(scorePush({ slug: 'badminton', summary: now, side: 'A', teamName: 'Smashers', prevSummary: prev })).toEqual({ title: 'Rubber to Smashers', body: 'Smashers wins rubber 1 · 2–0 in games · rubbers 1–0' });
  // A game that doesn't end the rubber is still a game push.
  const g = scorePush({ slug: 'badminton', summary: { A: { sets: [15], points: 0 }, B: { sets: [0], points: 0 }, rubbers: [] }, side: 'A', teamName: 'Smashers', prevSummary: { A: { sets: [] }, B: { sets: [] }, rubbers: [] } });
  expect(g?.title).toBe('Game to Smashers');
});

test('completion refuses a named winner the score contradicts (every best-of sport)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const src: string = require('fs').readFileSync(require('path').join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(src).toContain('if (bo && bo.scored && bo.decided && winnerSide && bo.leader && winnerSide !== bo.leader) {');
  expect(src).toContain("code: 'WINNER_NOT_LEADER',");
});
