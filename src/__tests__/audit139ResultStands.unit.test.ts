/** Audit #139 / #143 (11 Oct 2026, server). */
import fs from 'fs';
import path from 'path';
import { standsResultText } from '../controllers/matchDecision.controller';

test('#139 cricket "result stands" in runs; a level score in the sport’s word', () => {
  const n = { A: 'Lions', B: 'Tigers' };
  expect(standsResultText('cricket', n, { A: 150, B: 120 }, 'A')).toBe('Lions were ahead by 30 runs when play stopped (result stands)');
  expect(standsResultText('cricket', n, { A: 120, B: 121 }, 'B')).toBe('Tigers were ahead by 1 run when play stopped (result stands)');
  expect(standsResultText('cricket', n, { A: 90, B: 90 }, null)).toBe('Tied on 90 (result stands)');
  expect(standsResultText('football', n, { A: 2, B: 1 }, 'A')).toBe('Lions won 2–1 (result stands)');
  expect(standsResultText('football', n, { A: 1, B: 1 }, null)).toBe('Draw 1–1 (result stands)');
});

test('#143 the chips count every notification by type (migration 151), the sample only as a fallback', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/notifications.controller.ts'), 'utf8');
  expect(s).toContain("supabase.rpc('notification_type_counts', { p_user: userId })");
  expect(s).toContain('type_counts_complete: !!exact ||');
  const m = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/151_notification_type_counts.sql'), 'utf8');
  expect(m).toContain('GRANT EXECUTE ON FUNCTION notification_type_counts(uuid) TO service_role;');
});
