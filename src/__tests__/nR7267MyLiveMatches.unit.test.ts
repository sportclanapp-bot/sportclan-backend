/**
 * N-R7-267 (Step 2 B10, SP-VBL-C15): Home's live ticker read `/matches?mine=1`
 * (matches you CREATED), so a player on either team of a live match never saw
 * it there, and among 7,000 other live matches Home could not reach it at all.
 * GET /matches/my-live returns every live match you play in, created or follow,
 * reading 1000 rows at a time (no caps), the ones you play in first.
 */
type Row = Record<string, any>;
const db: Record<string, Row[]> = { matches: [], match_participants: [], team_members: [], match_followers: [] };

function q(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let order = 'id';
  let range: [number, number] = [0, 999];
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
    or: (expr: string) => {
      const parts = [...expr.matchAll(/(\w+)\.in\.\(([^)]*)\)/g)].map((m) => [m[1], m[2].split(',')] as const);
      filters.push((r) => parts.some(([c, vs]) => vs.includes(r[c])));
      return b;
    },
    order: (c: string) => { order = c; return b; },
    range: (from: number, to: number) => { range = [from, to]; return b; },
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      const rows = db[table].filter((r) => filters.every((f) => f(r)))
        .sort((x, y) => String(x[order]).localeCompare(String(y[order])))
        .slice(range[0], Math.min(range[1] + 1, range[0] + 1000)); // PostgREST: at most 1000 a read
      return Promise.resolve({ data: rows, error: null }).then(ok, bad);
    },
  };
  return b;
}
jest.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => q(t) } }));

import { myMatchesWithStatus, sortMyLive } from '../utils/nextMatch';

const ME = 'u-vw';
const pad = (n: number) => String(n).padStart(5, '0');
beforeAll(() => {
  // ~7,100 other live matches (test leftovers), none of them the viewer's.
  for (let i = 0; i < 7100; i++) db.matches.push({ id: `m-${pad(i)}`, status: 'live', voided_at: null, created_by: 'someone', team_a_id: 't-x', team_b_id: 't-y', scheduled_at: '2026-11-20T10:00:00Z' });
  // The C15 match: the viewer is on team B's roster (not the creator, not in a line-up).
  db.matches.push({ id: 'c15', status: 'live', voided_at: null, created_by: 'u-qc', team_a_id: 't-hawks', team_b_id: 't-viewers', scheduled_at: '2026-11-10T08:00:00Z' });
  db.team_members.push({ team_id: 't-viewers', user_id: ME });
  // One the viewer created, one they only follow, a voided one, a scheduled one.
  db.matches.push({ id: 'mine', status: 'live', voided_at: null, created_by: ME, team_a_id: 't-p', team_b_id: 't-q', scheduled_at: '2026-11-10T09:00:00Z' });
  db.matches.push({ id: 'fol', status: 'live', voided_at: null, created_by: 'u-z', team_a_id: 't-p', team_b_id: 't-q', scheduled_at: '2026-11-10T12:00:00Z' });
  db.match_followers.push({ match_id: 'fol', user_id: ME });
  db.matches.push({ id: 'void', status: 'live', voided_at: '2026-11-10T00:00:00Z', created_by: ME, team_a_id: 't-p', team_b_id: 't-q' });
  db.matches.push({ id: 'sched', status: 'scheduled', voided_at: null, created_by: 'u-z', team_a_id: 't-viewers', team_b_id: 't-q', scheduled_at: '2026-11-11T09:00:00Z' });
  // 1,200 more live matches of another team the viewer is on: every one comes back (paged, no cap).
  db.team_members.push({ team_id: 't-big', user_id: ME });
  for (let i = 0; i < 1200; i++) db.matches.push({ id: `big-${pad(i)}`, status: 'live', voided_at: null, created_by: 'u-z', team_a_id: 't-big', team_b_id: 't-q', scheduled_at: '2026-11-01T09:00:00Z' });
});

describe('N-R7-267 · your live matches', () => {
  test('a player on a team of a live match gets it, marked as one they play in', async () => {
    const rows = await myMatchesWithStatus(ME, 'live', { followed: true });
    const c15 = rows.find((r) => r.id === 'c15');
    expect(c15?.relation).toBe('plays');
  });
  test('created and followed live matches come too; voided, scheduled and strangers’ do not', async () => {
    const rows = await myMatchesWithStatus(ME, 'live', { followed: true });
    const ids = new Set(rows.map((r) => r.id));
    expect(rows.find((r) => r.id === 'mine')?.relation).toBe('created');
    expect(rows.find((r) => r.id === 'fol')?.relation).toBe('follows');
    expect(ids.has('void')).toBe(false);
    expect(ids.has('sched')).toBe(false);
    expect(ids.has('m-00000')).toBe(false);
  });
  test('no cap: all 1,200 live matches of one team come back', async () => {
    const rows = await myMatchesWithStatus(ME, 'live', { followed: true });
    expect(rows.filter((r) => r.id.startsWith('big-'))).toHaveLength(1200);
  });
  test('order: played/created before followed, latest start first', () => {
    const out = sortMyLive([
      { id: 'f', relation: 'follows' as const, scheduled_at: '2026-11-10T12:00:00Z' },
      { id: 'old', relation: 'plays' as const, scheduled_at: '2026-11-01T09:00:00Z' },
      { id: 'c', relation: 'created' as const, scheduled_at: '2026-11-10T09:00:00Z' },
      { id: 'new', relation: 'plays' as const, scheduled_at: '2026-11-10T08:00:00Z' },
    ]);
    expect(out.map((r) => r.id)).toEqual(['new', 'old', 'c', 'f']);
  });
  test('the scheduled list (Your next match) still finds a roster fixture', async () => {
    const rows = await myMatchesWithStatus(ME, 'scheduled');
    expect(rows.map((r) => r.id)).toEqual(['sched']);
  });
});
