/**
 * Visual review B05 (backend) · discovery lists.
 * V097        — scheduled lists come back soonest first.
 * V099/V102   — leaderboard ties break by matches played (D21).
 * V027/V098   — team rows carry the roster size (and the city, for the hub).
 */
import fs from 'fs';
import path from 'path';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('V097 · upcoming is soonest first', () => {
  it('status=scheduled orders scheduled_at ascending', () => {
    expect(code('controllers/matches.controller.ts')).toMatch(
      /status === 'scheduled'\s*\?\s*query\.order\('scheduled_at', \{ ascending: true, nullsFirst: false \}\)/,
    );
  });
});

describe('D21 · leaderboard ties break by matches played', () => {
  const l = code('controllers/leaderboard.controller.ts');
  it('in the database order', () => {
    expect(l).toMatch(/\.order\('rating', \{ ascending: false \}\)\s*\.order\('matches_played', \{ ascending: false \}\)\s*\.order\('wins', \{ ascending: false \}\)/);
  });
  it('and in the monthly (in-JS) order', () => {
    expect(l).toMatch(/b\.rating - a\.rating \|\|\s*b\.matches_played - a\.matches_played \|\|\s*b\.wins - a\.wins/);
  });
});

describe('V027/V098 · team rows say how big the team is', () => {
  it('the team list embeds the city and a roster count', () => {
    const t = code('controllers/teams.controller.ts');
    expect(t).toMatch(/select\('\*, city:cities!city_id\(id, name\), members:team_members\(count\)'/);
    expect(t).toMatch(/t\.member_count = Array\.isArray\(members\) \? \(members\[0\]\?\.count \?\? 0\) : null;/);
    expect(t).toMatch(/t\.city_name = t\.city\?\.name \?\? null;/);
  });
  it('team search results carry it too', () => {
    const s = code('controllers/search.controller.ts');
    expect(s).toMatch(/members:team_members\(count\)/);
    expect(s).toMatch(/member_count: Array\.isArray\(members\)/);
  });
});
