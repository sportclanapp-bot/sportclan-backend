import { CRICKET_OVERS, CRICKET_FORMAT_LABELS, inningsOvers, allOutWickets, allOutBySide, cricketFormatOf, isOfferedOvers, DEFAULT_OVERS, DEFAULT_ALL_OUT } from '../utils/cricketRules';
const CORE_REL = 'utils/cricketRules.ts';
const OTHER_REPO = '../sportclan-v2';
const OTHER_CORE_REL = 'src/scoring/cricketRules.ts';
/**
 * The shared cricket set-up rules (decision A6), held to ONE fixture table in
 * both repos. cricketRules.ts is byte-identical in the app and the server; this
 * test body is identical too (only the import path differs).
 */
import fs from 'fs';
import path from 'path';

describe('cricketRules', () => {
  test('every format offers overs; Pair is an overs match', () => {
    expect(CRICKET_OVERS.limited).toEqual({ options: [5, 10, 20, 50], standard: 20 });
    expect(CRICKET_OVERS.box).toEqual({ options: [4, 6, 8, 10], standard: 6 });
    expect(CRICKET_OVERS.pair).toEqual({ options: [4, 6, 8, 10], standard: 8 });
    expect(CRICKET_FORMAT_LABELS.pair).toBe('Pair (overs match)');
  });

  test('overs: the chosen ones, else 20 (a match from before this)', () => {
    expect(inningsOvers(6)).toBe(6);
    expect(inningsOvers(null)).toBe(20);
    expect(inningsOvers(0)).toBe(20);
    expect(DEFAULT_OVERS).toBe(20);
  });

  test('all out: one short of the line-up, at most 10; no line-up → 10', () => {
    expect(allOutWickets(11)).toBe(10);
    expect(allOutWickets(15)).toBe(10);
    expect(allOutWickets(6)).toBe(5);
    expect(allOutWickets(2)).toBe(1);
    expect(allOutWickets(1)).toBe(10);
    expect(allOutWickets(0)).toBe(10);
    expect(allOutWickets(null)).toBe(DEFAULT_ALL_OUT);
    expect(allOutBySide([{ team_side: 'A' }, { team_side: 'A' }, { team_side: 'A' }, { team_side: 'B' }])).toEqual({ A: 2, B: 10 });
  });

  test('format from the stored value; offered overs', () => {
    expect(cricketFormatOf('T20')).toBe('limited');
    expect(cricketFormatOf('box')).toBe('box');
    expect(cricketFormatOf('pair')).toBe('pair');
    expect(cricketFormatOf(null)).toBe('limited');
    expect(isOfferedOvers('box', 6)).toBe(true);
    expect(isOfferedOvers('box', 20)).toBe(false);
    expect(isOfferedOvers('limited', 50)).toBe(true);
    expect(isOfferedOvers('limited', null)).toBe(true);
  });

  const here = path.join(__dirname, '..', CORE_REL);
  const there = path.join(__dirname, '..', '..', OTHER_REPO, OTHER_CORE_REL);
  (fs.existsSync(there) ? test : test.skip)('the app and server copies are identical', () => {
    expect(fs.readFileSync(here, 'utf8')).toBe(fs.readFileSync(there, 'utf8'));
  });
});

describe('A6 on the server', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { deriveResultText } = require('../utils/matchResult') as typeof import('../utils/matchResult');
  test('"won by N wickets" counts wickets in hand against the side\'s line-up', () => {
    const r = deriveResultText({
      sport: 'cricket', teamAName: 'A', teamBName: 'B', aScore: 40, bScore: 41,
      aWickets: 3, bWickets: 2, bAllOut: 5, tossWinnerSide: 'A', tossChoice: 'bat', explicitWinner: null,
    });
    expect(r.text).toBe('B won by 3 wickets'); // 5 − 2, not 10 − 2
  });
  test('recompute caps wickets at the all-out; create refuses overs a format lacks', () => {
    const sc = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
    expect(sc).toContain('inn.wickets = Math.min(allOut[sideOf(p)], inn.wickets + 1)');
    const mc = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    expect(mc).toContain("code: 'BAD_OVERS'");
    expect(mc).toContain('overs: storedOvers,');
  });
});
