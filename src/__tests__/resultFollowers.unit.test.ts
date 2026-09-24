/** W-5: a match's followers are told the result, not only each set. */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
const start = src.indexOf('export async function completeMatch');
const body = src.slice(start, src.indexOf('\nexport ', start + 10));

describe('match_result audience', () => {
  test('participants, rosters and followers', () => {
    const at = body.indexOf("type: 'match_result'");
    const before = body.slice(0, at);
    expect(before).toContain('matchFollowerIds(id)');
    expect(before).toContain('new Set([...players, ...followers])');
  });
  test('the follower lookup reads match_followers', () => {
    const n = fs.readFileSync(path.join(__dirname, '../utils/notify.ts'), 'utf8');
    expect(n).toMatch(/export async function matchFollowerIds[\s\S]*from\('match_followers'\)/);
  });
});
