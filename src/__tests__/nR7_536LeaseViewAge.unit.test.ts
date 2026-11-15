/**
 * N-R7-536 (SIDE-X11x-1): a 9-s-old lease read '1m ago' on the blocked card; the phone parsed the database's
 * stamp ('…T17:09:43.37+05:30') itself. The lease goes out with plain ISO stamps and the heartbeat's age
 * worked out on the server's clock.
 */
import fs from 'fs';
import path from 'path';
import { leaseView, STALE_AFTER_MS } from '../utils/leaseCore';

const row = { user_id: 'u', device_id: 'd', claimed_at: '2026-11-15T17:09:43.37+05:30', heartbeat_at: '2026-11-15T17:09:43.37+05:30', taken_over_at: null };
const NOW = Date.parse('2026-11-15T11:39:52.370Z');

test('heartbeat_age_ms on the server clock, stamps as plain ISO', () => {
  const v = leaseView(row, { id: 'u', name: 'Asha' }, NOW);
  expect(v.heartbeat_age_ms).toBe(9_000);
  expect(v.heartbeat_at).toBe('2026-11-15T11:39:43.370Z');
  expect(v.claimed_at).toBe('2026-11-15T11:39:43.370Z');
  expect(v.taken_over_at).toBeNull();
  expect(v.server_time).toBe('2026-11-15T11:39:52.370Z');
  expect(v.stale).toBe(false);
  expect(v.stale_after_ms).toBe(STALE_AFTER_MS);
  expect(v.holder).toEqual({ id: 'u', name: 'Asha' });
});

test('stale past the window; a heartbeat ahead of the clock is age 0', () => {
  expect(leaseView(row, null, NOW + STALE_AFTER_MS).stale).toBe(true);
  expect(leaseView(row, null, NOW - 60_000).heartbeat_age_ms).toBe(0);
});

test('every lease response goes through leaseView', () => {
  const m = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(m).toMatch(/return leaseView\(lease,/);
});
