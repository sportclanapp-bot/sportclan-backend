/**
 * V-3 · a serve swap before the first rally does not start the match.
 * Test 3: C swapped the server at 0-0 (the toss) and the match went LIVE —
 * spectators saw "LIVE · 0 · 0" through the warm-up.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'scoring.controller.ts'), 'utf8');
const body = src.slice(src.indexOf('export async function createEvent'), src.indexOf('\nexport ', src.indexOf('export async function createEvent') + 10));

test('only an event that is play flips a scheduled match to live', () => {
  expect(body).toContain("const startsPlay = event_type !== 'serve_swap';");
  expect(body).toMatch(/if \(startsPlay && \(match\.status === 'scheduled' \|\| match\.status === 'upcoming'\)\) \{\s*try \{\s*await supabase\.from\('matches'\)\.update\(\{ status: 'live' \}\)/);
});

test('...and a pre-match swap is not held back by the ranked acceptance gate', () => {
  expect(body).toMatch(/if \(startsPlay && \(match\.status === 'scheduled' \|\| match\.status === 'upcoming'\)\) \{\s*const gate = await pendingRankedOpponent/);
});
