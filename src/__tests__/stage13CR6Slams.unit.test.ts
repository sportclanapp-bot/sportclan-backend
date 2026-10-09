/**
 * Stage 13 · CR4 / CR6 · carrom on the timeline: the toss (and the extra
 * board's), and a slam said on its board.
 */
import { sportCommentary } from '../utils/commentary';

const ctx = { sport: 'carrom', teamA: 'Ravi', teamB: 'Sana', period: 1 };

test('a White / Black slam says so on its board', () => {
  expect(sportCommentary('score', { kind: 'board', team_side: 'B', value: 12, slam: 'white' }, ctx)).toBe('🎯 White slam! ⚪ Board to Sana · +12');
  expect(sportCommentary('score', { kind: 'board', team_side: 'A', value: 5, slam: 'black' }, ctx)).toBe('🎯 Black slam! ⚪ Board to Ravi · +5');
  expect(sportCommentary('score', { kind: 'board', team_side: 'A', value: 5 }, ctx)).toBe('⚪ Board to Ravi · +5');
});

test('the toss: who won it, what they chose; the extra board’s toss', () => {
  expect(sportCommentary('note', { kind: 'toss', winner: 'A', choice: 'break' }, ctx)).toBe('🪙 Toss — Ravi won it and chose to break');
  expect(sportCommentary('note', { kind: 'toss', winner: 'B', choice: 'side' }, ctx)).toBe('🪙 Toss — Sana won it and chose a side (the other breaks)');
  expect(sportCommentary('note', { kind: 'toss', winner: 'B', extra: true }, ctx)).toBe('🪙 Toss for the extra board — Sana breaks');
});

test('the match summary counts slams (source)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain("if (carromSlams) summary.slams = carromSlams; // Stage 13 · CR6");
});
