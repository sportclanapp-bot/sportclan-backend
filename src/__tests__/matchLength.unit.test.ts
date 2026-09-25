import { MATCH_LENGTHS, bestOfFor, winsNeeded, isAcceptableMatchLength, matchLengthLabel, formatForBestOf } from '../utils/matchLength';
const CORE_REL = 'utils/matchLength.ts';
const OTHER_REPO = '../sportclan-v2';
const OTHER_CORE_REL = 'src/scoring/matchLength.ts';
/**
 * The shared match-length rule (decision B), held to ONE fixture table in both
 * repos. matchLength.ts is byte-identical in the app and the server; this test
 * body is identical too (only the import path differs).
 */
import fs from 'fs';
import path from 'path';

describe('matchLength', () => {
  test('each sport offers exactly the approved presets, standard first-class', () => {
    expect(MATCH_LENGTHS.badminton).toEqual({ options: [1, 3], standard: 3, unit: 'game' });
    expect(MATCH_LENGTHS.tabletennis).toEqual({ options: [1, 3, 5, 7], standard: 5, unit: 'game' });
    expect(MATCH_LENGTHS.pickleball).toEqual({ options: [1, 3], standard: 3, unit: 'game' });
    expect(MATCH_LENGTHS.volleyball).toEqual({ options: [3, 5], standard: 5, unit: 'set' });
    expect(MATCH_LENGTHS.tennis).toEqual({ options: [1, 3], standard: 3, unit: 'set' });
    expect(MATCH_LENGTHS.carrom).toEqual({ options: [1, 3], standard: 3, unit: 'game' });
    for (const s of ['cricket', 'football', 'hockey', 'basketball', 'chess']) expect(MATCH_LENGTHS[s]).toBeUndefined();
  });

  test('a preset is read from format; anything else is the standard length', () => {
    expect(bestOfFor('badminton', 'bo1')).toBe(1);
    expect(bestOfFor('badminton', 'bo3')).toBe(3);
    expect(bestOfFor('badminton', 'badminton')).toBe(3); // an older match: the slug
    expect(bestOfFor('badminton', null)).toBe(3);
    expect(bestOfFor('badminton', 'bo5')).toBe(3); // not offered → standard
    expect(bestOfFor('table-tennis', 'bo7')).toBe(7); // DB slug form
    expect(bestOfFor('tabletennis', undefined)).toBe(5);
    expect(bestOfFor('volleyball', 'bo3')).toBe(3);
    expect(bestOfFor('football', 'bo3')).toBeNull();
  });

  test('wins needed', () => {
    expect([1, 3, 5, 7].map(winsNeeded)).toEqual([1, 2, 3, 4]);
  });

  test('creation accepts offered presets and non-presets, refuses the rest', () => {
    expect(isAcceptableMatchLength('badminton', 'bo1')).toBe(true);
    expect(isAcceptableMatchLength('badminton', 'badminton')).toBe(true);
    expect(isAcceptableMatchLength('badminton', null)).toBe(true);
    expect(isAcceptableMatchLength('badminton', 'bo7')).toBe(false);
    expect(isAcceptableMatchLength('volleyball', 'bo1')).toBe(false);
    expect(isAcceptableMatchLength('cricket', 'bo3')).toBe(true); // not a best-of sport
  });

  test('labels', () => {
    expect(matchLengthLabel('badminton', 'bo1')).toBe('1 game');
    expect(matchLengthLabel('badminton', 'bo3')).toBe('Best of 3');
    expect(matchLengthLabel('tennis', 'bo1')).toBe('1 set');
    expect(matchLengthLabel('volleyball', 'bo3')).toBe('Best of 3 sets');
    expect(matchLengthLabel('carrom', 'carrom')).toBe('Best of 3');
    expect(matchLengthLabel('chess', 'Blitz · 5+0')).toBeNull();
    expect(formatForBestOf(5)).toBe('bo5');
  });

  const here = path.join(__dirname, '..', CORE_REL);
  const there = path.join(__dirname, '..', '..', OTHER_REPO, OTHER_CORE_REL);
  (fs.existsSync(there) ? test : test.skip)('the app and server copies are identical', () => {
    expect(fs.readFileSync(here, 'utf8')).toBe(fs.readFileSync(there, 'utf8'));
  });
});
