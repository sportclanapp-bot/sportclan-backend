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
import { leaseVerdict, leaseRefusal } from '../utils/leaseCore';

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
  const v = leaseVerdict(lease, userId, deviceId);
  return v.ok ? 'ok' : v.code;
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

  it('no device id while a lease exists is refused — the raw API is not a backdoor', () => {
    // It used to pass on identity alone, so the holder's own login without the
    // header could write around the phone holding the pad (user-flow test 4).
    // Every app request carries the id; the match page included.
    expect(verdict(held, 'ravi', null)).toBe('DEVICE_REQUIRED');
    expect(verdict(held, 'ravi', undefined)).toBe('DEVICE_REQUIRED');
    expect(verdict(held, 'asha', null)).toBe('LEASE_LOST');
    // …and with no lease there is nothing to protect.
    expect(verdict(null, 'ravi', null)).toBe('ok');
  });

  it('the refusal says why, so an older app degrades honestly', () => {
    expect(leaseRefusal({ code: 'DEVICE_REQUIRED' })).toEqual({
      error: expect.stringContaining('did not say which device'),
      code: 'DEVICE_REQUIRED',
    });
    expect(leaseRefusal({ code: 'LEASE_LOST' }).code).toBe('LEASE_LOST');
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
