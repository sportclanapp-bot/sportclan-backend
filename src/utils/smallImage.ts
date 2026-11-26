/**
 * Item 34 (25 Nov 2026) · the small copy of an uploaded image. A photo is stored at up to 1200 px; an avatar or
 * a thumbnail needs a fraction of it. `<id>.v2.jpg` has a small copy beside it at `<id>.v2.s.jpg` (best effort:
 * the app shows the full one when it isn't there). A photo from before is `<id>.jpg`; its small copy, once the
 * backfill has made it, is `<id>.s.jpg`. Copies are only ever added.
 */
export const SMALL_IMAGE_SIDE = 320;
export const SMALL_IMAGE_QUALITY = 75;
export function smallKeyOf(key: string): string {
  return key.replace(/\.jpg$/i, '.s.jpg');
}
/** The backfill's list: our photos with no small copy yet. */
export function keysNeedingSmall(keys: readonly string[]): string[] {
  const have = new Set(keys);
  return keys.filter((k) => /^profile-photos\/.+\.jpg$/i.test(k) && !/\.s\.jpg$/i.test(k) && !have.has(smallKeyOf(k)));
}
