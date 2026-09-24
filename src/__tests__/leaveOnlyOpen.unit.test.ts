/**
 * V-1 · "Leave match" is for open pickups only.
 *
 * Test 3: both singles players were offered "Leave match" before the start —
 * leaving strands the other player with a one-person match. Server refuses it;
 * the app hides it (app-side test in phase3Wiring).
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
const body = src.slice(src.indexOf('export async function leaveMatch'), src.indexOf('\nexport ', src.indexOf('export async function leaveMatch') + 10));

test('a non-open match refuses a leave, before the RPC touches anything', () => {
  const guard = body.indexOf("code: 'NOT_AN_OPEN_MATCH'");
  const rpc = body.indexOf("supabase.rpc('leave_open_match'");
  expect(guard).toBeGreaterThan(-1);
  expect(guard).toBeLessThan(rpc);
  expect(body).toContain('if (m && !m.is_open)');
});

test('it tells a singles player what to do instead', () => {
  expect(body).toContain('decline the challenge instead');
});
