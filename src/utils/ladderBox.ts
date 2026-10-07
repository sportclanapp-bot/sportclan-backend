/**
 * Stage 9 · T16 (Oct 2026) · ladders and box leagues — ONE set of rules for the
 * app and the server.
 *
 * This file is byte-identical in both repos:
 *   app     src/tournament/ladderBox.ts
 *   server  src/utils/ladderBox.ts
 * Edit both, or neither.
 *
 * LADDER: entries hold positions (1 = top). A player challenges someone above,
 * up to `reach` places (no limit when unset); one open challenge each at a time.
 * The challenger who wins moves up — 'leapfrog' (takes the place; everyone
 * between drops one) or 'swap' (the two change places). A defender who wins
 * stays. New entries join at the bottom.
 *
 * BOX LEAGUE: the field in order, cut into boxes of `size`; each box plays a
 * round robin. After a round the top `up` of each box go up a box and the
 * bottom `down` go down one; the next round's boxes are made from the new
 * order. New entries join the bottom box. No top on the size of either.
 *
 * Sports: the one-on-one and pair sports — badminton, tennis, table tennis,
 * pickleball, chess and carrom.
 */

export const LADDER_SPORTS = ['badminton', 'tennis', 'tabletennis', 'pickleball', 'chess', 'carrom'] as const;
export type LadderMove = 'leapfrog' | 'swap';
export type LadderSettings = { reach?: number | null; move?: LadderMove };
export type BoxSettings = { size: number; up: number; down: number; round?: number };

export const LADDER_REACH_DEFAULT = 3;
export const BOX_DEFAULT: BoxSettings = { size: 5, up: 1, down: 1 };

const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** Why ladder settings can't be (the organiser's words), or null. */
export function ladderSettingsProblem(l: unknown): string | null {
  if (l == null) return null;
  if (typeof l !== 'object' || Array.isArray(l)) return 'Ladder settings are how far up and how a win moves.';
  const o = l as Record<string, unknown>;
  if (o.reach != null && (!whole(o.reach) || o.reach < 1)) return 'A challenge reaches 1 place up or more.';
  if (o.move != null && o.move !== 'leapfrog' && o.move !== 'swap') return 'A win takes the place, or swaps places.';
  return null;
}

/** Why box settings can't be, or null. */
export function boxSettingsProblem(b: unknown): string | null {
  if (b == null) return null;
  if (typeof b !== 'object' || Array.isArray(b)) return 'Box settings are a size and who goes up and down.';
  const o = b as Record<string, unknown>;
  if (!whole(o.size) || o.size < 3) return 'A box has 3 players or more.';
  if (!whole(o.up) || o.up < 0 || !whole(o.down) || o.down < 0) return 'Up and down are whole numbers, 0 or more.';
  if (o.up + o.down > o.size) return `Up and down together are at most the box size (${o.size}).`;
  if (o.round != null && (!whole(o.round) || o.round < 0)) return 'The round is a whole number.';
  return null;
}

/** The reach a ladder uses (null: anyone above). */
export const reachOf = (l: LadderSettings | null | undefined): number | null => (l && 'reach' in l ? (l.reach ?? null) : LADDER_REACH_DEFAULT);

/**
 * Why `challenger` can't challenge `defender` on this ladder (positions from
 * `order`, top first), or null. `busy`: entries with an open challenge.
 */
export function challengeProblem(order: ReadonlyArray<string>, challenger: string, defender: string, l: LadderSettings | null | undefined, busy: ReadonlySet<string> = new Set()): string | null {
  const c = order.indexOf(challenger);
  const d = order.indexOf(defender);
  if (c < 0) return 'You aren’t on this ladder.';
  if (d < 0) return 'They aren’t on this ladder.';
  if (c === d) return 'You can’t challenge yourself.';
  if (d > c) return 'Challenge someone above you.';
  const reach = reachOf(l);
  if (reach != null && c - d > reach) return `You can challenge up to ${reach} ${reach === 1 ? 'place' : 'places'} above you.`;
  if (busy.has(challenger)) return 'You have a challenge to play first.';
  if (busy.has(defender)) return 'They have a challenge to play first.';
  return null;
}

/** Who a player can challenge now (top first). */
export function challengeable(order: ReadonlyArray<string>, challenger: string, l: LadderSettings | null | undefined, busy: ReadonlySet<string> = new Set()): string[] {
  return order.filter((d) => challengeProblem(order, challenger, d, l, busy) === null);
}

/** The ladder after a challenge: the challenger won (moves up), or not (no change). */
export function ladderAfter(order: ReadonlyArray<string>, challenger: string, defender: string, challengerWon: boolean, move: LadderMove = 'leapfrog'): string[] {
  const out = [...order];
  const c = out.indexOf(challenger);
  const d = out.indexOf(defender);
  if (!challengerWon || c < 0 || d < 0 || c < d) return out;
  if (move === 'swap') { out[d] = challenger; out[c] = defender; return out; }
  out.splice(c, 1);
  out.splice(d, 0, challenger);
  return out;
}

/** The boxes for an order (top first). A last box of fewer than 3 joins the one above. */
export function boxesOf<T>(order: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < order.length; i += size) out.push(order.slice(i, i + size));
  if (out.length > 1 && out[out.length - 1]!.length < 3) { const last = out.pop()!; out[out.length - 1]!.push(...last); }
  return out;
}

/**
 * The next round's order from each box's final table (each box top first):
 * the top `up` go up a box, the bottom `down` down one. Then `joiners` (new
 * entries) at the bottom.
 */
export function nextBoxOrder<T>(tables: ReadonlyArray<ReadonlyArray<T>>, up: number, down: number, joiners: ReadonlyArray<T> = []): T[] {
  const n = tables.length;
  const ups = tables.map((t, b) => (b > 0 ? t.slice(0, Math.min(up, t.length)) : []));
  const downs = tables.map((t, b) => (b < n - 1 ? t.slice(t.length - Math.min(down, t.length - ups[b]!.length)) : []));
  const stay = tables.map((t, b) => t.slice(ups[b]!.length, t.length - downs[b]!.length));
  const out: T[] = [];
  // Each new box: those who came down from above, the stayers, then those who came up from below.
  for (let b = 0; b < n; b++) out.push(...(b > 0 ? downs[b - 1]! : []), ...stay[b]!, ...(b < n - 1 ? ups[b + 1]! : []));
  return [...out, ...joiners];
}

/** "Box 2" — a box's label from its number. */
export const boxLabel = (n: number | string): string => `Box ${n}`;
