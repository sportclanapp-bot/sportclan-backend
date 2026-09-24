/**
 * T-1 · the server derives tennis from per-POINT events.
 *
 * SET_CONFIG.tennis treated each 'score' event as a GAME won, but the app sends
 * one per point — so a tennis match's stored summary, hub card and result were
 * built from points counted as games. Tennis now has its own branch through the
 * shared tennisCore (tested by the fixture table in tennisCore.unit.test).
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'scoring.controller.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

test('tennis is no longer in the per-game SET_CONFIG table', () => {
  const table = src.slice(src.indexOf('const SET_CONFIG'), src.indexOf('};', src.indexOf('const SET_CONFIG')));
  expect(table).not.toMatch(/\btennis\s*:/);
});

test('tennis replays score events, one per point, through the shared core', () => {
  expect(src).toMatch(/slug === 'tennis'\)\s*\{\s*tennisState = tennisReplay\(\s*events\.filter\(\(e\) => e\.event_type === 'score'\)/);
});

test('it stores sets won, games per set, the current games and points, and tiebreaks', () => {
  for (const field of ['A.score = tennisState.setsWon.A', 'A.sets = tennisState.sets.map', 'A.games = tennisState.games.A', 'A.points = tennisState.points.A', 'summary.tiebreak = tennisState.tiebreak', 'summary.set_tiebreaks']) {
    expect(src).toContain(field);
  }
});
