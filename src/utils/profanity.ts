/**
 * The bad-language check for posts, wall posts, comments and team names.
 *
 * SC-68: the original list was matched with a naive `lower.includes(w)` substring
 * test, so short entries blocked innocent words that merely CONTAIN them —
 * 'ass' killed association/class/pass/grass/assist, 'dick' killed Dickinson,
 * 'crap' killed scrap/scrape, 'retard' killed (fire) retardant, 'randi' killed
 * grandiose/brandish. Those moved to whole-word matching (PROFANITY_WORD).
 *
 * N-RWG6-2 (launch test plan): the rest were still matched as substrings, so
 * common Indian names were refused — Kshitij, Shital, Ashita ('shit'), Scunthorpe
 * ('cunt'). Every term now matches only as a whole word: the term, optionally
 * with a common ending (fucking, shitty, bitches, pissed, shithead…) or a common
 * front (motherfucker, bullshit, dipshit, goddamn…). A name that merely contains
 * the letters passes.
 */

const PROFANITY_ROOT = [
  'fuck', 'shit', 'bitch', 'damn', 'bastard', 'piss', 'slut', 'whore',
  'cunt', 'nigger', 'faggot',
  'madarchod', 'bhenchod', 'chutiya', 'gaandu', 'harami',
];

// Endings and fronts a root takes in real abuse. Kept short on purpose: each one
// is a whole-word form, so 'shit' + 'al' (Shital) or 'k' + 'shit' + 'ij' (Kshitij)
// never match.
const ROOT_FRONT = ['mother', 'bull', 'dip', 'horse', 'bat', 'dog', 'chicken', 'ape', 'holy', 'god', 'cluster', 'dumb'];
const ROOT_END = [
  's', 'es', 'ed', 'er', 'ers', 'ing', 'in', 'y', 'ty', 'ter', 'ters', 'ting', 'tier', 'tiest', 'ish', 'it',
  'head', 'heads', 'hole', 'holes', 'face', 'faced', 'wit', 'wits', 'bag', 'bags', 'ass', 'load', 'show', 'storm',
];

const PROFANITY_WORD = [
  'ass', 'asshole', 'asshat', 'asswipe', 'dumbass', 'jackass', 'smartass', 'badass',
  'dick', 'dickhead',
  'crap',
  'retard', 'retarded',
  'randi',
];

// Precompiled once. \b is a word boundary, so \bass\b matches "ass"/"kick his
// ass"/"bad-ass" but NOT "association"/"class"/"badass" (the latter is caught by
// its own explicit entry above).
const PROFANITY_RES = [
  ...PROFANITY_ROOT.map((w) => ({
    word: w,
    re: new RegExp(`\\b(?:${ROOT_FRONT.join('|')})?${w}(?:${ROOT_END.join('|')})?\\b`, 'i'),
  })),
  ...PROFANITY_WORD.map((w) => ({ word: w, re: new RegExp(`\\b${w}\\b`, 'i') })),
];

/** The listed words found in `text` (each once), or [] when it is clean. */
export function detectProfanity(text: string): string[] {
  const hits = new Set<string>();
  for (const { word, re } of PROFANITY_RES) {
    if (re.test(text)) hits.add(word);
  }
  return [...hits];
}
