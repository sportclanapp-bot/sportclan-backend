/**
 * SC-433 · one hub per tournament.
 *
 * The same lease as SC-430's, one level up, and now literally the same code —
 * `leaseCore`. So what is worth pinning here is not the mechanics a second time,
 * but the thing that CHANGES when you move up a level: what a quiet heartbeat
 * means.
 *
 * A scoring lease goes quiet because a phone died. A hub goes quiet because it is
 * standing in a field with no signal, which is the entire reason it exists. So
 * "stale" must never read as "abandoned" — an organiser collecting results all
 * morning must still hold the hub at lunchtime.
 */
import { isStale, STALE_AFTER_MS } from '../utils/hubLease';
import { isStale as scoringIsStale, STALE_AFTER_MS as SCORING_WINDOW } from '../utils/scoringLease';
import { leaseVerdict } from '../utils/leaseCore';

const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const heartbeat = (agoMs: number) => ({ heartbeat_at: new Date(NOW - agoMs).toISOString() });

describe('SC-433 · hub staleness', () => {
  it('a hub heard from a moment ago is not stale', () => {
    expect(isStale(heartbeat(30_000), NOW)).toBe(false);
  });

  it('goes stale exactly at the window, not before', () => {
    expect(isStale(heartbeat(STALE_AFTER_MS - 1), NOW)).toBe(false);
    expect(isStale(heartbeat(STALE_AFTER_MS), NOW)).toBe(true);
  });

  it('a hub offline all morning is stale — which means TAKEABLE, not gone', () => {
    // The distinction the whole design rests on. Staleness never deletes the row
    // and never frees it; it only means another organiser MAY take over, with a
    // reason. The morning's results stay on that phone either way.
    expect(isStale(heartbeat(4 * 3600_000), NOW)).toBe(true);
  });

  it('is the same rule as the scoring lease, because it is the same code', () => {
    // If these ever diverge it will be because someone copied the module rather
    // than instantiating it — which is exactly what leaseCore exists to prevent.
    expect(STALE_AFTER_MS).toBe(SCORING_WINDOW);
    for (const ago of [0, 1_000, STALE_AFTER_MS - 1, STALE_AFTER_MS, 10 * 3600_000]) {
      expect(isStale(heartbeat(ago), NOW)).toBe(scoringIsStale(heartbeat(ago), NOW));
    }
  });
});

/**
 * The verdict `check` reaches, as a pure function of the row — mirrors leaseCore
 * exactly, so the rule is pinned without a database.
 */
type Row = { user_id: string; device_id: string } | null;
const verdict = (lease: Row, userId: string, deviceId?: string | null) => {
  const v = leaseVerdict(lease, userId, deviceId);
  return v.ok ? 'ok' : v.code === 'LEASE_LOST' ? 'HUB_LOST' : v.code;
};

describe('SC-433 · who may run the hub', () => {
  const held = { user_id: 'ravi', device_id: 'phone-1' };

  it('the holder, on the holding device', () => {
    expect(verdict(held, 'ravi', 'phone-1')).toBe('ok');
  });

  it('a co-organiser on another phone is refused', () => {
    expect(verdict(held, 'priya', 'phone-2')).toBe('HUB_LOST');
  });

  it('the SAME organiser on a second phone is refused — the case it exists for', () => {
    // Two hubs run by one person is the commonest way to end up with two
    // half-complete pictures of the same tournament day.
    expect(verdict(held, 'ravi', 'phone-2')).toBe('HUB_LOST');
  });

  it('no lease at all means yes', () => {
    // Refusing every write until a lease exists would break every path that
    // predates this, for no safety gain. A lease stops a SECOND hub.
    expect(verdict(null, 'anyone', 'any-phone')).toBe('ok');
  });

  it('no device id while a hub lease exists is refused (same core rule as scoring)', () => {
    expect(verdict(held, 'ravi', null)).toBe('DEVICE_REQUIRED');
  });
});
