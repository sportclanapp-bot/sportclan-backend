/**
 * SC-332 · Play-invite 48h expiry — UNIT tests of the pure freshness logic.
 *
 * The 48h boundary can't be walked in a live test and prod can't be backdated from
 * here (no service key), so the decision logic is extracted into pure, time-injected
 * functions and exercised at the exact boundary with a simulated `nowMs`. The live
 * integration suite covers the happy path + withdraw; this proves the >48h behaviour.
 */
import {
  INVITE_TTL_MS,
  isInviteActivePending,
  isInviteExpired,
  decideInviteDedup,
} from '../controllers/invites.controller';

const NOW = Date.UTC(2026, 6, 20, 12, 0, 0); // fixed clock
const iso = (ms: number) => new Date(ms).toISOString();
const ageMs = (h: number) => NOW - h * 60 * 60 * 1000;

describe('INVITE_TTL_MS', () => {
  it('is exactly 48 hours', () => {
    expect(INVITE_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });
});

describe('isInviteActivePending', () => {
  it('a fresh pending invite (<48h) is active', () => {
    expect(isInviteActivePending({ status: 'pending', created_at: iso(ageMs(47)) }, NOW)).toBe(true);
    expect(isInviteActivePending({ status: 'pending', created_at: iso(ageMs(0)) }, NOW)).toBe(true);
  });
  it('a pending invite past 48h is NOT active', () => {
    expect(isInviteActivePending({ status: 'pending', created_at: iso(ageMs(49)) }, NOW)).toBe(false);
    expect(isInviteActivePending({ status: 'pending', created_at: iso(ageMs(48.01)) }, NOW)).toBe(false);
  });
  it('resolved statuses are never "active pending"', () => {
    for (const status of ['accepted', 'declined', 'expired']) {
      expect(isInviteActivePending({ status, created_at: iso(ageMs(1)) }, NOW)).toBe(false);
    }
  });
});

describe('isInviteExpired', () => {
  it('fresh pending is not expired; stale pending is', () => {
    expect(isInviteExpired({ status: 'pending', created_at: iso(ageMs(1)) }, NOW)).toBe(false);
    expect(isInviteExpired({ status: 'pending', created_at: iso(ageMs(49)) }, NOW)).toBe(true);
  });
  it('a row already stored as expired is expired regardless of age', () => {
    expect(isInviteExpired({ status: 'expired', created_at: iso(ageMs(1)) }, NOW)).toBe(true);
  });
  it('accepted/declined are not "expired" (they are resolved, still actionable-guarded elsewhere)', () => {
    expect(isInviteExpired({ status: 'accepted', created_at: iso(ageMs(99)) }, NOW)).toBe(false);
    expect(isInviteExpired({ status: 'declined', created_at: iso(ageMs(99)) }, NOW)).toBe(false);
  });
});

describe('decideInviteDedup', () => {
  it('no prior rows → insert', () => {
    expect(decideInviteDedup([], NOW)).toEqual({ action: 'insert' });
  });

  it('a FRESH pending row → already_invited (dedup)', () => {
    const rows = [{ id: 'p1', status: 'pending', created_at: iso(ageMs(2)) }];
    expect(decideInviteDedup(rows, NOW)).toEqual({ action: 'already_invited' });
  });

  it('a STALE pending row (>48h) → reuse (refresh in place, no dup)', () => {
    const rows = [{ id: 'p1', status: 'pending', created_at: iso(ageMs(50)) }];
    expect(decideInviteDedup(rows, NOW)).toEqual({ action: 'reuse', id: 'p1' });
  });

  it('only a resolved row → reuse it (reopen)', () => {
    for (const status of ['declined', 'accepted', 'expired']) {
      const rows = [{ id: 'r1', status, created_at: iso(ageMs(100)) }];
      expect(decideInviteDedup(rows, NOW)).toEqual({ action: 'reuse', id: 'r1' });
    }
  });

  it('stale pending alongside a resolved row → reuse the (stale) PENDING one', () => {
    // Keeps the single pending row (uq_invites_pending) rather than creating another.
    const rows = [
      { id: 'p1', status: 'pending', created_at: iso(ageMs(60)) },
      { id: 'r1', status: 'declined', created_at: iso(ageMs(200)) },
    ];
    expect(decideInviteDedup(rows, NOW)).toEqual({ action: 'reuse', id: 'p1' });
  });

  it('boundary: exactly 48h old counts as stale (>= cutoff is fresh, < is stale)', () => {
    const at48 = iso(NOW - INVITE_TTL_MS); // exactly at cutoff → still active
    const past48 = iso(NOW - INVITE_TTL_MS - 1); // 1ms older → stale
    expect(decideInviteDedup([{ id: 'a', status: 'pending', created_at: at48 }], NOW)).toEqual({
      action: 'already_invited',
    });
    expect(decideInviteDedup([{ id: 'b', status: 'pending', created_at: past48 }], NOW)).toEqual({
      action: 'reuse',
      id: 'b',
    });
  });
});
