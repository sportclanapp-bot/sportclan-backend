/** Possessives read right: "Lions' innings ended", "Tigers XI's innings ended". */
import { possessive } from '../utils/possessive';

it.each([
  ['Lions', 'Lions’'],
  ['Tigers XI', 'Tigers XI’s'],
  ['S5 KO Cup', 'S5 KO Cup’s'],
  ['Pune Kings', 'Pune Kings’'],
])('%s → %s', (name, want) => expect(possessive(name)).toBe(want));
