/**
 * N-RWG6-2 (launch test plan, Round 4) · a post naming Kshitij or Shital was refused
 * as bad language ('Please remove: shit.'): the check matched most words as plain
 * substrings. Every word now matches only as a whole word (with its common endings
 * and fronts), so names that merely contain the letters pass. Posts, wall posts,
 * comments and team names all use this one check.
 */
import { detectProfanity } from '../utils/profanity';
import { detectProfanity as fromCommunity } from '../controllers/community.controller';

describe('names and ordinary words pass', () => {
  it.each([
    'Great knock by Kshitij today',
    'Shital bowled well',
    'Ashita and Shitanshu opened',
    'Well bowled Kshitij',
    'Scunthorpe United',
    'Hitesh, Shitij and Dipshita',
    'Amsterdam',
    'association', 'class', 'grass court', 'Emily Dickinson', 'scrap metal', 'fire retardant', 'grandiose',
  ])('"%s" is clean', (t) => expect(detectProfanity(t)).toEqual([]));
});

describe('real abuse is still caught', () => {
  it.each([
    ['shit', 'shit'], ['this is shit!', 'shit'], ['bullshit', 'shit'], ['dipshit', 'shit'], ['shitty umpire', 'shit'], ['shithead', 'shit'],
    ['motherfucker', 'fuck'], ['fucking hell', 'fuck'], ['FUCK', 'fuck'], ['fucked', 'fuck'],
    ['bitches', 'bitch'], ['pissed off', 'piss'], ['goddamn', 'damn'], ['damn it', 'damn'], ['bastards', 'bastard'],
    ['you cunt', 'cunt'], ['whores', 'whore'], ['chutiya', 'chutiya'], ['madarchod', 'madarchod'],
    ['you ass', 'ass'], ['dumbass', 'dumbass'], ['dickhead', 'dickhead'], ['this is crap', 'crap'],
  ])('"%s" → %s', (t, w) => expect(detectProfanity(t)).toContain(w));
});

it('the community controller still exports the same check', () => {
  expect(fromCommunity('Kshitij')).toEqual([]);
  expect(fromCommunity('bullshit')).toEqual(['shit']);
});
