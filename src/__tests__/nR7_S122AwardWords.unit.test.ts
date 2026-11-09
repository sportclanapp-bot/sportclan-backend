/**
 * N-R7-S122 (GF2-083): an award titled 'Biggest crap player' was saved and printed on the awards poster and a
 * certificate — award titles and typed names skipped the word check team names and posts pass.
 */
import { awardsProfanity } from '../controllers/awards.controller';
import fs from 'fs';
import path from 'path';

test('a title or a typed name with a listed word is caught', () => {
  expect(awardsProfanity([{ title: 'Biggest crap player', user_id: 'u1' }])).toEqual(['crap']);
  expect(awardsProfanity([{ title: 'Best fielder', name: 'crap guy' }])).toEqual(['crap']);
});
test('clean awards pass', () => {
  expect(awardsProfanity([{ title: 'Player of the tournament', user_id: 'u1' }, { title: 'Best spiker', name: 'Ravi K' }])).toEqual([]);
  expect(awardsProfanity(undefined)).toEqual([]);
});
test('setAwards refuses PROFANITY_DETECTED before saving', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/awards.controller.ts'), 'utf8');
  const body = src.slice(src.indexOf('export async function setAwards'));
  expect(body.indexOf('awardsProfanity(awards)')).toBeGreaterThan(-1);
  expect(body.indexOf('awardsProfanity(awards)')).toBeLessThan(body.indexOf(".update({ settings: next })"));
});
