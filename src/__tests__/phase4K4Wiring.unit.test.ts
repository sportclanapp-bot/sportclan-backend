/**
 * Phase 4 · K4 · wiring the fixes' own tests left open. Each fix below shipped
 * a tested helper; these pin that the handler still goes through it, so
 * putting the old inline code back fails here.
 */
import fs from 'fs';
import path from 'path';
import { CHESS_RESULT_REASONS } from '../utils/chessRules';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const fnBody = (src: string, name: string) => {
  const i = src.indexOf(`export async function ${name}(`);
  expect(i).toBeGreaterThan(-1);
  return src.slice(i, src.indexOf('\nexport ', i + 10));
};

describe('K4-7 (d83501b) · V-5 live score pushes go through scorePush', () => {
  const createEvent = fnBody(code('controllers/scoring.controller.ts'), 'createEvent');

  it('K4-7 (d83501b): a score that ends nothing sends no push — createEvent returns before the fan-out', () => {
    expect(createEvent).toMatch(
      /const push = scorePush\(\{[\s\S]{0,400}?\}\);\s*if \(!push\) return res\.json\(\{ event \}\);\s*const \{ title, body \} = push;\s*void fanoutScoreUpdate\(matchId, title, body, userId\);/,
    );
  });

  it('K4-7 (d83501b): the old every-rally "scores! a-b" line is gone from createEvent', () => {
    expect(createEvent).not.toMatch(/scores! \$\{val\(summary\.A\)\}-\$\{val\(summary\.B\)\}/);
    expect(createEvent).not.toMatch(/Array\.isArray\(s\.sets\)\) return s\.points/);
  });
});

describe('K4-19 (9149fab) · F-14/F-20/F-19 createMatch names its sides through teamSidesFor', () => {
  const createMatch = fnBody(code('controllers/matches.controller.ts'), 'createMatch');

  it('K4-19 (9149fab): a team-mode create runs teamSidesFor and returns its refusal', () => {
    expect(createMatch).toMatch(
      /:\s*teamSidesFor\(\{ isOpen: !!is_open, teamAId: team_a_id, teamBId: team_b_id, teamAName: team_a_name, teamBName: team_b_name \}\);\s*if \(sides && 'code' in sides\) return res\.status\(sides\.status\)\.json\(\{ error: sides\.error, code: sides\.code \}\);/,
    );
  });

  it('K4-19 (9149fab): the stored names are the ones teamSidesFor settled ("Team A" for a blank pickup side)', () => {
    expect(createMatch).toContain('team_a_name: singlesSides ? singlesSides.aName : sides?.a ?? null,');
    expect(createMatch).toContain('team_b_name: singlesSides ? singlesSides.bName : sides?.b ?? null,');
  });
});

describe('K4-46 (62a4213) · V203 chess result reasons read as words, one style', () => {
  it('K4-46 (62a4213): every reason label is words only — no emoji, no ½, no keycap digits', () => {
    const labels = [...CHESS_RESULT_REASONS.decisive, ...CHESS_RESULT_REASONS.draw].map((r) => r.label);
    expect(labels).toEqual([
      'Checkmate', 'Resignation', 'Timeout',
      'By agreement', 'Stalemate', 'Repetition', 'Insufficient material', '50-move rule',
    ]);
    for (const l of labels) expect(l).toMatch(/^[A-Za-z0-9][A-Za-z0-9 -]*$/);
  });
});

describe('K4-47 (3f6a78c) · possessives of names ending in s', () => {
  it('K4-47 (3f6a78c): the tournament-updated push uses possessive(), not a bare "’s"', () => {
    const t = code('controllers/tournaments.controller.ts');
    expect(t).toContain("body: `${tournamentName ? possessive(tournamentName) : 'A tournament’s'} schedule or venue changed");
    expect(t).not.toMatch(/\$\{tournamentName \?\? 'A tournament'\}'s schedule/);
  });
});
