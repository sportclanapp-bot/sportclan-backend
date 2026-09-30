/** BUILD 3.71 · chess ratings per time control (migration 115). */
import fs from 'fs';
import path from 'path';
import { timeControlOf } from '../utils/chessTcRatings';

test('the time control comes from the match’s clock', () => {
  expect(timeControlOf({ rules: { v: 1, baseMinutes: 1, incrementSeconds: 0 } })).toBe('bullet');
  expect(timeControlOf({ rules: { v: 1, baseMinutes: 3, incrementSeconds: 2 } })).toBe('blitz');
  expect(timeControlOf({ rules: { v: 1, baseMinutes: 15, incrementSeconds: 10 } })).toBe('rapid');
  expect(timeControlOf({ rules: { v: 1, baseMinutes: 90, incrementSeconds: 30 } })).toBe('classical');
  expect(timeControlOf({ format: 'Rapid · 10+0' })).toBe('blitz'); // an older match: its clock, 10+0 — blitz since 30 Sep (FIDE)
  expect(timeControlOf({ rules: { v: 1, baseMinutes: 10, incrementSeconds: 0 } })).toBe('blitz');
  expect(timeControlOf({ rules: { v: 1, baseMinutes: 10, incrementSeconds: 1 } })).toBe('rapid');
  expect(timeControlOf({})).toBe('blitz'); // the standard 5+0
});

test('wired: completion (ranked 1v1 chess), void and restore, and the read endpoint', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const m = read('controllers/matches.controller.ts');
  expect(m).toContain("if (match.is_ranked && !walkover && normSportSlug(sportRow?.slug) === 'chess' && participants) {");
  expect(m).toContain('await applyChessTcDeltas(id, -1);');
  expect(m).toContain('await applyChessTcDeltas(id, 1);');
  expect(read('routes/users.routes.ts')).toContain("router.get('/:id/chess-ratings', authenticateToken, getChessRatings);");
  // Idempotent: history first, and only inserted rows move a rating.
  const u = read('utils/chessTcRatings.ts');
  expect(u).toContain("{ onConflict: 'user_id,match_id', ignoreDuplicates: true }");
});
