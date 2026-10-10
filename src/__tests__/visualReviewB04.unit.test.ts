/**
 * Visual review B04 (backend) · Home.
 * V006/V252 (D1) — GET /matches/next: the soonest scheduled match you play in.
 * V001 (D1)      — most-active cards carry a real "matches this week" count.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../utils/supabase', () => ({ supabase: {} }));
// eslint-disable-next-line import/first
import { pickNextMatch, NEXT_MATCH_GRACE_HOURS } from '../utils/nextMatch';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const NOW = Date.parse('2026-09-27T12:00:00Z');
const at = (h: number) => ({ id: `m${h}`, scheduled_at: new Date(NOW + h * 3600_000).toISOString() });

describe('pickNextMatch', () => {
  it('nothing → no card', () => {
    expect(pickNextMatch([], NOW)).toEqual({ match: null, overdue: false });
  });
  it('the soonest one ahead, whatever order the rows come in', () => {
    expect(pickNextMatch([at(48), at(3), at(24)], NOW)).toEqual({ match: at(3), overdue: false });
  });
  it('a match that started within the grace window comes first, marked overdue', () => {
    expect(pickNextMatch([at(3), at(-1)], NOW)).toEqual({ match: at(-1), overdue: true });
  });
  it('past the grace window, a future match wins over a stale one', () => {
    expect(pickNextMatch([at(-(NEXT_MATCH_GRACE_HOURS + 1)), at(5)], NOW)).toEqual({ match: at(5), overdue: false });
  });
  it('only stale ones → the most recent, overdue ("start or reschedule")', () => {
    expect(pickNextMatch([at(-200), at(-30)], NOW)).toEqual({ match: at(-30), overdue: true });
  });
  it('undated rows are never picked', () => {
    expect(pickNextMatch([{ id: 'x', scheduled_at: null }], NOW).match).toBeNull();
  });
});

describe('which matches count as yours', () => {
  const s = code('utils/nextMatch.ts');
  it('line-up, either team roster, or created by you', () => {
    expect(s).toMatch(/from\('match_participants'\)\.select\('match_id'\)\.eq\('user_id', userId\)/);
    expect(s).toMatch(/from\('team_members'\)\.select\('team_id'\)\.eq\('user_id', userId\)/);
    expect(s).toMatch(/\.eq\('created_by', userId\)/);
    expect(s).toMatch(/teamIds\.slice\(i, i \+ 100\)/); // Stage 16: 100 teams a read (a long URL failed)
    expect(s).toMatch(/team_a_id\.in\.\(/);
    expect(s).toMatch(/team_b_id\.in\.\(/);
  });
  it('only scheduled, unvoided matches', () => {
    expect(s).toMatch(/\.eq\('status', 'scheduled'\)\.is\('voided_at', null\)/);
  });
  it("the route sits before '/:id'", () => {
    const r = code('routes/matches.routes.ts');
    expect(r.indexOf("router.get('/next'")).toBeGreaterThan(-1);
    expect(r.indexOf("router.get('/next'")).toBeLessThan(r.indexOf("router.get('/:id'"));
  });
});

describe('most active this week · a real weekly count', () => {
  const f = code('controllers/features.controller.ts');
  it('counts completed, unvoided matches finished this week, per player and sport', () => {
    const i = f.indexOf('async function matchesThisWeek(');
    const body = f.slice(i, i + 900);
    expect(body).toMatch(/\.eq\('match\.status', 'completed'\)/);
    expect(body).toMatch(/\.is\('match\.voided_at', null\)/);
    expect(body).toMatch(/\.gte\('match\.completed_at', since\)/);
  });
  it('a player with no match this week is not shown, and the count is returned', () => {
    expect(f).toMatch(/if \(weekly && !weekly\.get\(`\$\{p\.user_id\}:\$\{p\.sport_id\}`\)\) continue;/);
    expect(f).toMatch(/matches_this_week: weekly\?\.get\(/);
  });
});
