import { shootoutApplies, validShootout, shootoutWinner, shootoutResultText, SHOOTOUT_MAX } from '../utils/shootoutRules';
const CORE_REL = 'utils/shootoutRules.ts';
const OTHER_REPO = '../sportclan-v2';
const OTHER_CORE_REL = 'src/scoring/shootoutRules.ts';
/**
 * The shared shootout rule (decision A2), held to ONE fixture table in both
 * repos. shootoutRules.ts is byte-identical in the app and the server; this
 * test body is identical too (only the import path differs).
 */
import fs from 'fs';
import path from 'path';

describe('shootoutRules', () => {
  test('only knockout football and hockey', () => {
    expect(shootoutApplies('football', true)).toBe(true);
    expect(shootoutApplies('hockey', true)).toBe(true);
    expect(shootoutApplies('football', false)).toBe(false); // casual / league / group: a draw stands
    expect(shootoutApplies('basketball', true)).toBe(false);
    expect(shootoutApplies('cricket', true)).toBe(false);
  });
  test('a shootout score is two different whole numbers 0..30', () => {
    expect(validShootout(4, 3)).toBe(true);
    expect(validShootout(0, 1)).toBe(true);
    expect(validShootout(3, 3)).toBe(false);
    expect(validShootout(-1, 2)).toBe(false);
    expect(validShootout(31, 2)).toBe(false);
    expect(validShootout(2.5, 2)).toBe(false);
    expect(validShootout('4', 3)).toBe(false);
    expect(SHOOTOUT_MAX).toBe(30);
  });
  test('winner and result wording', () => {
    expect(shootoutWinner(4, 3)).toBe('A');
    expect(shootoutWinner(2, 5)).toBe('B');
    expect(shootoutResultText({ sport: 'football', winnerName: 'Lions', goals: { A: 2, B: 2 }, shootout: { A: 4, B: 3 } }))
      .toBe('Lions won 2–2 (4–3 pens)');
    expect(shootoutResultText({ sport: 'hockey', winnerName: 'Tigers', goals: { A: 1, B: 1 }, shootout: { A: 2, B: 5 } }))
      .toBe('Tigers won 1–1 (5–2 shootout)');
  });

  const here = path.join(__dirname, '..', CORE_REL);
  const there = path.join(__dirname, '..', '..', OTHER_REPO, OTHER_CORE_REL);
  (fs.existsSync(there) ? test : test.skip)('the app and server copies are identical', () => {
    expect(fs.readFileSync(here, 'utf8')).toBe(fs.readFileSync(there, 'utf8'));
  });
});

describe('A2 on the server', () => {
  test('completion validates the shootout and writes it into the result', () => {
    const mc = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    for (const code of ['SHOOTOUT_NOT_ALLOWED', 'BAD_SHOOTOUT', 'SHOOTOUT_WINNER_MISMATCH']) expect(mc).toContain(code);
    expect(mc).toContain('ss.shootout = shootoutScore;');
  });
  test('a later recompute keeps it', () => {
    const sc = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
    expect(sc).toContain("'walkover_reason', 'shootout'] as const");
  });
});
