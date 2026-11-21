/** Q58 (Dipak, 21 Nov 2026: B) · N-R7-S87: GET /matches/history hands each row its seat (migration 168), for the app's badge. */
import fs from 'fs';
import path from 'path';

test('matchHistory passes the page item seat as my_seat', () => {
  const s = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(s).toContain("page: Array<{ id: string; side: string | null; role: 'played' | 'officiated'; seat?: string | null }>");
  expect(s).toContain('my_role: p.role, my_side: p.side ?? null, my_seat: p.seat ?? null');
});
