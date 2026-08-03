/**
 * SC-408 · "accepted" must mean "understood".
 *
 * POST /scoring/:matchId/event took any event_type with a 201. The innings
 * aggregator filters on 'ball' and ignored the rest, but the partnership view
 * sums payload.runs broadly — so four bogus {"event_type":"run","runs":4}
 * events gave an innings of 24 and a partnership of 40 on the same screen.
 */
import { isKnownEventType, KNOWN_EVENT_TYPES } from '../utils/scoringEvents';

describe('isKnownEventType', () => {
  it('rejects the exact bogus type that caused the 24-vs-40 split', () => {
    expect(isKnownEventType('run')).toBe(false);
  });

  it('accepts every cricket event the aggregator reads', () => {
    for (const t of ['ball', 'extra', 'wicket', 'declaration']) {
      expect(isKnownEventType(t)).toBe(true);
    }
  });

  it('accepts the other sports’ events so this gate cannot break them', () => {
    for (const t of ['goal', 'assist', 'basket', 'move', 'score', 'point']) {
      expect(isKnownEventType(t)).toBe(true);
    }
  });

  it('rejects non-strings rather than throwing', () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(isKnownEventType(v)).toBe(false);
    }
  });

  it('is case-sensitive — "Ball" is not "ball"', () => {
    expect(isKnownEventType('Ball')).toBe(false);
  });

  it('has no duplicate entries', () => {
    expect(new Set(KNOWN_EVENT_TYPES).size).toBe(KNOWN_EVENT_TYPES.length);
  });
});
