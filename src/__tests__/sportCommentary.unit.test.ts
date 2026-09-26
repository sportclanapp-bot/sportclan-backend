/**
 * The timeline for football, hockey and basketball (2026-09-26, after
 * MATCH_CREATE_TEST_5). F1's timeline read `card {"kind":"red","team_side":"B"}`,
 * `period_change {"kind":"halftime"}` and "Point to Team B" for every goal —
 * the own goal included, against the side that conceded it.
 */
import fs from 'fs';
import path from 'path';
import { sportCommentary } from '../utils/commentary';

const ctx = (sport: string, period = 1) => ({ sport, teamA: 'Smoke Tigers', teamB: 'Smoke Lions', period });

test('goals name the team and the scorer; an own goal says who conceded and who gains', () => {
  expect(sportCommentary('score', { team_side: 'A', kind: 'goal', player_name: 'QA Device A' }, ctx('football'))).toBe('⚽ GOAL! Smoke Tigers — QA Device A');
  expect(sportCommentary('score', { team_side: 'B', kind: 'goal' }, ctx('hockey'))).toBe('🥅 GOAL! Smoke Lions');
  expect(sportCommentary('score', { team_side: 'B', kind: 'own_goal' }, ctx('football'))).toBe('🙈 Own goal by Smoke Lions — goal to Smoke Tigers');
});

test('cards name the player when there is one, else the team', () => {
  expect(sportCommentary('card', { team_side: 'A', kind: 'yellow', player_name: 'QA Device C' }, ctx('football'))).toBe('🟨 Yellow card — QA Device C (Smoke Tigers)');
  expect(sportCommentary('card', { team_side: 'B', kind: 'red' }, ctx('football'))).toBe('🟥 Red card — Smoke Lions');
  expect(sportCommentary('card', { team_side: 'B', kind: 'green', player_name: 'QA Device D' }, ctx('hockey'))).toBe('🟩 Green card — QA Device D (Smoke Lions)');
});

test('periods and penalty corners in words', () => {
  expect(sportCommentary('period_change', { kind: 'halftime' }, ctx('football'))).toBe('Half-time');
  expect(sportCommentary('period_change', { kind: 'quarter' }, ctx('hockey', 3))).toBe('End of Q3');
  expect(sportCommentary('period_change', { kind: 'quarter' }, ctx('basketball', 5))).toBe('End of OT1');
  expect(sportCommentary('note', { team_side: 'A', kind: 'pen_corner' }, ctx('hockey'))).toBe('🏑 Penalty corner — Smoke Tigers');
  expect(sportCommentary('score', { team_side: 'A', value: 3, player_name: 'QA Device A' }, ctx('basketball'))).toBe('🏀 3-pointer — Smoke Tigers (QA Device A)');
});

test('chess: numbered moves with the clock, and the result in words', () => {
  const c = { sport: 'chess', teamA: 'QA Device A', teamB: 'QA Device B', period: 1 };
  expect(sportCommentary('move', { side: 'A' }, { ...c, move: 1, clockSeconds: 171 })).toBe('♟️ White moved · move 1 · 2:51 left');
  expect(sportCommentary('move', { side: 'B' }, { ...c, move: 2, clockSeconds: null })).toBe('♟️ Black moved · move 2');
  expect(sportCommentary('result', { winner: 'black', reason: 'checkmate', player_id: 'x', player_name: 'QA Device B' }, c)).toBe('🏁 Black wins — checkmate (QA Device B)');
  expect(sportCommentary('result', { winner: 'draw', reason: 'fifty_move' }, c)).toBe('🤝 Draw — 50-move rule');
});

test('serve changes, carrom boards and tennis aces in words', () => {
  expect(sportCommentary('serve_swap', { kind: 'serve_swap' }, ctx('badminton'))).toBe('🔁 Serve changed');
  expect(sportCommentary('score', { team_side: 'B', kind: 'board', value: 12 }, ctx('carrom'))).toBe('⚪ Board to Smoke Lions · +12');
  expect(sportCommentary('score', { team_side: 'A', kind: 'ace' }, ctx('tennis'))).toBe('🎾 Ace — point to Smoke Tigers');
});

test('other sports keep their own lines', () => {
  expect(sportCommentary('score', { team_side: 'A' }, ctx('badminton'))).toBeNull();
  const mc = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(mc).toContain("commentary = `${p.team_side === 'B' ? teamB : teamA} declared`;");
});

test('the endpoint uses it, knows cricket by its slug, and counts balls per innings', () => {
  const mc = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  const fn = mc.slice(mc.indexOf('export async function getCommentary'), mc.indexOf('// GET /matches/:id\n'));
  expect(fn).toContain("const isCricket = slug === 'cricket';");
  expect(fn).not.toContain(".includes('cric')");
  expect(fn).toContain('legalBallsBySide[side] += 1;');
  expect(fn).toContain('sport: slug, teamA, teamB, period: periods - 1, move: moves, clockSeconds: (ev as any).clock_seconds ?? null,');
});
