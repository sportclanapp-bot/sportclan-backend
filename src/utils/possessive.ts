/**
 * A name's possessive, the way it is written: "Lions' innings", "Tigers XI's
 * innings", "Priya's profile". A name ending in s takes an apostrophe only —
 * "Lions's" read wrong. Curly apostrophe to match the app's copy.
 */
export function possessive(name: string): string {
  const n = name.trim();
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}
