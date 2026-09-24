/** V-7: server-written counts agree with their noun ("1 match played"). */
import fs from 'fs';
import path from 'path';
import { plural } from '../utils/plural';

describe('plural', () => {
  it('singular only for exactly one', () => {
    expect(plural(1, 'match', 'matches')).toBe('1 match');
    expect(plural(0, 'match', 'matches')).toBe('0 matches');
    expect(plural(4, 'new follower', 'new followers')).toBe('4 new followers');
  });
  it('digest bodies go through it', () => {
    const f = fs.readFileSync(path.join(__dirname, '../controllers/features.controller.ts'), 'utf8');
    const n = fs.readFileSync(path.join(__dirname, '../controllers/notifications.controller.ts'), 'utf8');
    expect(f).not.toMatch(/\$\{mp\} matches/);
    expect(f).not.toMatch(/\$\{nf\} players/);
    expect(n).not.toMatch(/\$\{stats\.matches_played\} matches/);
  });
});
