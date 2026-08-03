/**
 * SC-408 · the set of scoring events the aggregators actually understand.
 *
 * The bug: `POST /scoring/:matchId/event` accepted ANY `event_type` string with
 * a 201 and persisted it. No aggregator recognised it, so it contributed nothing
 * to the innings — a scorer who mistyped an event got "success" and a score that
 * silently refused to move.
 *
 * Worse, it did not stay inert. The innings aggregator filters on
 * `event_type === 'ball'`, but the partnership view sums `payload.runs` from
 * whatever events it finds. So four bogus `{"event_type":"run","runs":4}` events
 * produced an innings of 24 and a partnership of 40 on the SAME screen — two
 * numbers from one ledger that disagreed, with nothing to say which was wrong.
 *
 * This list is derived from every `event_type === '…'` comparison in the
 * scoring/stats controllers, so an event that passes this gate is one something
 * downstream can read. Adding a new event type means adding it here — which is
 * the point: the allowlist is what makes "accepted" mean "understood".
 */

export const KNOWN_EVENT_TYPES = [
  // Cricket
  'ball',
  'extra',
  'wicket',
  'declaration',
  // Football / hockey
  'goal',
  'assist',
  'foul',
  'yellow_card',
  'red_card',
  // Basketball
  'basket',
  // Chess
  'move',
  'queen',
  // Generic / shared
  'score',
  'point',
  'sub',
  'timeout',
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

const KNOWN = new Set<string>(KNOWN_EVENT_TYPES);

export function isKnownEventType(value: unknown): value is KnownEventType {
  return typeof value === 'string' && KNOWN.has(value);
}
