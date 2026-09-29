/**
 * A `.in('col', ids)` filter travels in the URL. A few hundred uuids take it
 * past what the database gateway accepts, and the whole request fails with a
 * 400 the controller reports as a 500. Found on the device (BUILD 1.13): an
 * account in a few hundred tournament and match chats got a 500 for its chat
 * list and its unread badge — live too. Anything that builds an id list from a
 * user's memberships goes through here.
 */
export const IN_CHUNK = 150;

export function chunks<T>(xs: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
