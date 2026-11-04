/**
 * V-5 · a game-ending point quotes the game it ended; a mid-game rally sends
 * nothing. Test 3: 92 pushes per player for one badminton match, one of them
 * "SC434 Fresh QA scores! 0-0" for the point that won a game.
 */
import { scorePush, quarterPush } from '../utils/scorePush';

const bad = (a: { sets: number[]; points: number }, b: { sets: number[]; points: number }) => ({ A: a, B: b });

test('badminton: a mid-game rally sends nothing', () => {
  expect(scorePush({ slug: 'badminton', side: 'A', teamName: 'A', summary: bad({ sets: [21], points: 5 }, { sets: [16], points: 3 }) })).toBeNull();
});

test('badminton: the point that ends a game quotes THAT game, winner first', () => {
  const p = scorePush({ slug: 'badminton', side: 'B', teamName: 'QA Flow Test', summary: bad({ sets: [21, 21], points: 0 }, { sets: [16, 23], points: 0 }) });
  expect(p).toEqual({ title: 'Game to QA Flow Test', body: 'QA Flow Test wins game 2 · 23–21' });
  expect(p!.body).not.toMatch(/0-0/);
});

test('volleyball calls it a set, carrom a board', () => {
  expect(scorePush({ slug: 'volleyball', side: 'A', teamName: 'X', summary: bad({ sets: [25], points: 0 }, { sets: [20], points: 0 }) })!.body).toBe('X wins set 1 · 25–20');
  expect(scorePush({ slug: 'carrom', side: 'A', teamName: 'X', summary: bad({ sets: [25], points: 0 }, { sets: [12], points: 0 }) })!.body).toBe('X wins game 1 · 25–12');
});

test('tennis: a game inside a set sends nothing; a set end quotes the set and its tiebreak', () => {
  const mid = { A: { sets: [], games: 3, points: 0 }, B: { sets: [], games: 2, points: 0 } };
  expect(scorePush({ slug: 'tennis', side: 'A', teamName: 'A', summary: mid })).toBeNull();
  const end = { A: { sets: [6, 3, 7], games: 0, points: 0 }, B: { sets: [4, 6, 6], games: 0, points: 0 }, set_tiebreaks: [null, null, { A: 7, B: 5 }] };
  expect(scorePush({ slug: 'tennis', side: 'A', teamName: 'SC434 Fresh QA', summary: end }))
    .toEqual({ title: 'Set to SC434 Fresh QA', body: 'SC434 Fresh QA wins set 3 · 7–6(5)' });
});

test('football goals are unchanged: every one is the moment', () => {
  expect(scorePush({ slug: 'football', side: 'A', teamName: 'FC', kind: 'goal', summary: { A: { score: 2 }, B: { score: 1 } } }))
    .toEqual({ title: 'GOAL!', body: 'FC scores! 2–1' });
});

test('basketball: a basket sends nothing — ~150 of them a game', () => {
  expect(scorePush({ slug: 'basketball', side: 'A', teamName: 'Hoops', kind: 'three', summary: { A: { points: 45 }, B: { points: 40 } } })).toBeNull();
});

test('basketball: the end of a quarter does, with the score', () => {
  expect(quarterPush({ quarter: 2, teamAName: 'Hoops', teamBName: 'Dunkers', summary: { A: { points: 45 }, B: { points: 40 } } }))
    .toEqual({ title: 'End of Q2', body: 'Hoops 45–40 Dunkers' });
});

test('the quarter push fires on period_change, for basketball only', () => {
  const fs = require('fs') as typeof import('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toMatch(/event_type === 'period_change' && wasNew[\s\S]{0,400}slug === 'basketball'[\s\S]{0,600}quarterPush\(/);
});

test('N-R7-103: in a team tie a game push counts the games of the rubber being played, and names it', () => {
  // Swaythling: rubber 1 went 3-0 (games 11-5 ×3); rubber 2's first game just ended 11-5.
  const prev = { A: { sets: [11, 11, 11], points: 10 }, B: { sets: [5, 5, 5], points: 5 }, rubbers: [{ A: 3, B: 0, winner: 'A' }] };
  const summary = { A: { sets: [11, 11, 11, 11], points: 0 }, B: { sets: [5, 5, 5, 5], points: 0 }, rubbers: [{ A: 3, B: 0, winner: 'A' as const }] };
  expect(scorePush({ slug: 'tabletennis', summary, prevSummary: prev, side: 'A', teamName: 'Deccan' }))
    .toEqual({ title: 'Game to Deccan', body: 'Deccan wins game 1 of rubber 2 · 11–5' });
  // rubber 1, game 1 (no rubber finished yet): the tie block says it is a tie
  const tie = { win: 'first' };
  expect(scorePush({ slug: 'tabletennis', summary: { A: { sets: [11], points: 0 }, B: { sets: [5], points: 0 }, rubbers: [], tie } as never, prevSummary: { A: { sets: [] }, B: { sets: [] } }, side: 'A', teamName: 'Deccan' })?.body)
    .toBe('Deccan wins game 1 of rubber 1 · 11–5');
  // a single match (no rubbers) keeps its words
  expect(scorePush({ slug: 'tabletennis', summary: { A: { sets: [11, 9], points: 0 }, B: { sets: [8, 11], points: 0 } }, prevSummary: { A: { sets: [11] }, B: { sets: [8] } }, side: 'B', teamName: 'Bina' })?.body)
    .toBe('Bina wins game 2 · 11–9');
});
