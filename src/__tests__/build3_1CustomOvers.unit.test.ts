/**
 * BUILD 3.1 · cricket overs are any whole number 1–50 on create and edit, by
 * the shared rule (cricketRules.isOfferedOvers, matchRules.rulesRefusal). It
 * replaces BUILD 1.9's offered-overs rule.
 */
import { isOfferedOvers } from '../utils/cricketRules';
import { rulesRefusal, standardRules } from '../utils/matchRules';
import { formatRefusal } from '../controllers/matches.controller';

test('any whole 1 or more (Stage 13 · CR3: no top), any format', () => {
  expect(isOfferedOvers('limited', 12)).toBe(true);
  expect(isOfferedOvers('box', 7)).toBe(true);
  expect(isOfferedOvers('pair', 50)).toBe(true);
  for (const n of [51, 200]) expect(isOfferedOvers('limited', n)).toBe(true);
  for (const n of [0, -1, 12.5]) expect(isOfferedOvers('limited', n)).toBe(false);
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), overs: 12 })).toBeNull();
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), overs: 51 })).toBeNull();
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), overs: 200 })).toBeNull();
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), overs: 0 })?.error).toBe('Overs must be a whole number, 1 or more.');
});
test('T12 with overs 12 is a matching format', () => {
  expect(formatRefusal('cricket', 'T12', 12)).toBeNull();
  expect(formatRefusal('cricket', 'T12', 20)?.code).toBe('FORMAT_OVERS_MISMATCH');
});
