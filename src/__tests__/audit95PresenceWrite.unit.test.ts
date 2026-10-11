/** Audit #95 (11 Oct 2026): every signed-in request wrote last_active_at; now at most once every 30 s per person. */
import { shouldWritePresence, PRESENCE_WRITE_MS } from '../middleware/auth.middleware';

test('once per window per person', () => {
  const t = 1_000_000;
  expect(shouldWritePresence('u1', t)).toBe(true);
  expect(shouldWritePresence('u1', t + 1000)).toBe(false);
  expect(shouldWritePresence('u2', t + 1000)).toBe(true);
  expect(shouldWritePresence('u1', t + PRESENCE_WRITE_MS)).toBe(true);
});
