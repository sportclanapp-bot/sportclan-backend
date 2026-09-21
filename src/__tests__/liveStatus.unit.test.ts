/**
 * SC-428 · telling a viewer WHY the scoreboard has not moved.
 *
 * A frozen scoreboard has three causes and they demand different words: the
 * viewer's own connection died, the match is genuinely quiet, or the scorer has
 * lost signal. The app resolves the first by itself. Separating the other two is
 * the whole job of this classifier, and getting it wrong in either direction is
 * a lie — "scorer offline" during a drinks break, or a confident LIVE while a
 * scorer stands in a field with twenty queued points.
 */
import { classify, QUIET_AFTER_MS } from '../utils/liveStatus';
import { ONLINE_WINDOW_MS } from '../controllers/users.controller';

const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();

describe('SC-428 · scorer signal', () => {
  it('recent scoring is simply "scoring" — presence is irrelevant then', () => {
    expect(classify('live', agoMs(10_000), null, NOW)).toBe('scoring');
    expect(classify('live', agoMs(10_000), agoMs(10 * 60_000), NOW)).toBe('scoring');
  });

  it('no scoring but a warm heartbeat is QUIET, not offline', () => {
    // The drinks-break case. Calling this "scorer offline" would be a lie.
    expect(classify('live', agoMs(QUIET_AFTER_MS + 60_000), agoMs(5_000), NOW)).toBe('quiet');
  });

  it('no scoring AND no heartbeat is "maybe_offline" — never a certainty', () => {
    expect(
      classify('live', agoMs(QUIET_AFTER_MS + 60_000), agoMs(ONLINE_WINDOW_MS + 60_000), NOW),
    ).toBe('maybe_offline');
  });

  it('a live match that has never had an event leans on presence alone', () => {
    expect(classify('live', null, agoMs(5_000), NOW)).toBe('quiet');
    expect(classify('live', null, null, NOW)).toBe('maybe_offline');
  });

  it('is only meaningful for a LIVE match', () => {
    for (const s of ['scheduled', 'completed', 'abandoned', 'cancelled', null, undefined]) {
      expect(classify(s, agoMs(10_000), agoMs(10_000), NOW)).toBe('unknown');
    }
  });

  it('the boundaries land on the right side', () => {
    // Just inside the quiet window is still "scoring".
    expect(classify('live', agoMs(QUIET_AFTER_MS - 1), null, NOW)).toBe('scoring');
    // Just outside it, with presence just inside, is quiet.
    expect(classify('live', agoMs(QUIET_AFTER_MS + 1), agoMs(ONLINE_WINDOW_MS - 1), NOW)).toBe('quiet');
    // Both outside → maybe_offline.
    expect(classify('live', agoMs(QUIET_AFTER_MS + 1), agoMs(ONLINE_WINDOW_MS + 1), NOW)).toBe('maybe_offline');
  });

  it('a scorer who dropped seconds ago still reads as present — a stated limit', () => {
    // Presence cannot resolve finer than the heartbeat window. Pinned so the
    // limitation is deliberate rather than a surprise.
    expect(classify('live', agoMs(QUIET_AFTER_MS + 1), agoMs(1_000), NOW)).toBe('quiet');
  });
});
