/**
 * SC-430 · one scorer per match.
 *
 * The failure this prevents is not corruption — two phones scoring one match do
 * not damage each other's writes. They simply BOTH count, so two scorers tapping
 * every rally produce double the score and nothing says so.
 *
 * The rules that matter most are about EXPIRY, because they are the ones a real
 * venue tests: a scorer who walks out of signal must keep their queue, and a dead
 * phone must not block the match forever. Those two pull in opposite directions,
 * and `stale ≠ released` is what reconciles them.
 */
import { isStale, STALE_AFTER_MS } from '../utils/scoringLease';

const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const heartbeat = (agoMs: number) => ({ heartbeat_at: new Date(NOW - agoMs).toISOString() });

describe('SC-430 · staleness', () => {
  it('a warm lease is not stale', () => {
    expect(isStale(heartbeat(10_000), NOW)).toBe(false);
  });

  it('goes stale exactly at the window, not before', () => {
    expect(isStale(heartbeat(STALE_AFTER_MS - 1), NOW)).toBe(false);
    expect(isStale(heartbeat(STALE_AFTER_MS), NOW)).toBe(true);
  });

  it('a lease from hours ago is stale — takeable, which is not the same as gone', () => {
    expect(isStale(heartbeat(6 * 3600_000), NOW)).toBe(true);
  });
});

/**
 * The verdict `checkLease` reaches, as a pure function of the row, so the rule is
 * pinned without a database. Mirrors utils/scoringLease exactly.
 */
type Lease = { user_id: string; device_id: string } | null;
const verdict = (lease: Lease, userId: string, deviceId?: string | null) => {
  if (!lease) return 'ok';
  if (lease.user_id !== userId) return 'LEASE_LOST';
  if (deviceId && lease.device_id !== deviceId) return 'LEASE_LOST';
  return 'ok';
};

describe('SC-430 · who may write', () => {
  const held = { user_id: 'ravi', device_id: 'phone-1' };

  it('the holder, on the holding device, may write', () => {
    expect(verdict(held, 'ravi', 'phone-1')).toBe('ok');
  });

  it('a different PERSON is refused', () => {
    expect(verdict(held, 'asha', 'phone-2')).toBe('LEASE_LOST');
  });

  it('the SAME person on a second handset is refused — the case this exists for', () => {
    // Otherwise a scorer who opened the pad on their tablet too would double-score
    // their own match, and nothing would flag it.
    expect(verdict(held, 'ravi', 'phone-2')).toBe('LEASE_LOST');
  });

  it('NO lease means yes — the lease stops a second scorer, it does not gate the first', () => {
    // Refusing every write until a lease exists would break paths that predate
    // this feature, and a queue replayed from before it shipped, for no gain.
    expect(verdict(null, 'anyone', 'any-device')).toBe('ok');
  });

  it('a caller with no device id is judged on identity alone', () => {
    // An organiser correcting an event from the match page has no pad and no
    // device context; locking them out over a header they never sent would be
    // a worse bug than the one being fixed.
    expect(verdict(held, 'ravi', null)).toBe('ok');
    expect(verdict(held, 'asha', null)).toBe('LEASE_LOST');
  });
});

describe('SC-430 · expiry is the part a venue tests', () => {
  /**
   * Takeover is allowed only on a STALE lease (or a voluntary hand-over). These
   * pin the two halves of the tension the design has to hold at once.
   */
  const mayTakeOver = (lease: { heartbeat_at: string } | null, now: number, force = false) =>
    !lease || force || isStale(lease, now);

  it('a live lease cannot be taken — no silent ejection', () => {
    expect(mayTakeOver(heartbeat(30_000), NOW)).toBe(false);
  });

  it('a stale lease CAN be taken, so a dead phone cannot block the match forever', () => {
    expect(mayTakeOver(heartbeat(STALE_AFTER_MS + 1000), NOW)).toBe(true);
  });

  it('a voluntary hand-over bypasses staleness — nobody is being displaced', () => {
    expect(mayTakeOver(heartbeat(1000), NOW, true)).toBe(true);
  });

  it('going stale does NOT free the lease, so an offline scorer can still drain', () => {
    // The crux. Staleness only makes a lease TAKEABLE. Until somebody actually
    // takes it, the holder still holds it — which is why a queue built in a field
    // with no signal still drains hours later.
    const stale = { user_id: 'ravi', device_id: 'phone-1', heartbeat_at: new Date(NOW - 6 * 3600_000).toISOString() };
    expect(isStale(stale, NOW)).toBe(true);
    expect(verdict(stale, 'ravi', 'phone-1')).toBe('ok'); // still theirs
  });

  it('once taken over, the old phone is refused — and learns of it as a 409', () => {
    const afterTakeover = { user_id: 'asha', device_id: 'phone-2' };
    expect(verdict(afterTakeover, 'ravi', 'phone-1')).toBe('LEASE_LOST');
  });
});
