/**
 * Hard-delete list #6 (27 Sep 2026) · disbanding a team (captain, or the last
 * member leaving) marks it, never removes it (migration 106).
 */
import fs from 'fs';
import path from 'path';

const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let rows: unknown[] = [{ id: 't1' }];
let single: unknown = null;
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {};
      const rec = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
      for (const op of ['select', 'eq', 'is', 'in', 'not', 'update', 'delete']) q[op] = rec(op);
      q.maybeSingle = () => Promise.resolve({ data: single, error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
      return q;
    },
  },
}));
// eslint-disable-next-line import/first
import { softDisbandTeam, refuseDisbandedTeam, TEAM_DISBANDED, disbandedTeamIds } from '../utils/teamVisibility';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const fnBody = (f: string, name: string) => {
  const s = code(f);
  const i = s.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};
const T = 'controllers/teams.controller.ts';

beforeEach(() => { calls.length = 0; rows = [{ id: 't1' }]; single = null; });

describe('softDisbandTeam', () => {
  test('marks the team with who and how; touches nothing else', async () => {
    expect(await softDisbandTeam('t1', 'u1', 'last_member_left')).toBe(true);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
    expect(calls.filter((c) => c.op === 'update').map((c) => c.table)).toEqual(['teams']);
    expect(calls.find((c) => c.op === 'update')?.args[0]).toMatchObject({ deleted_by: 'u1', deleted_reason: 'last_member_left' });
    expect(calls).toEqual(expect.arrayContaining([{ table: 'teams', op: 'is', args: ['deleted_at', null] }]));
  });
  test('already disbanded → false', async () => {
    rows = [];
    expect(await softDisbandTeam('t1', 'u1', 'captain_disband')).toBe(false);
  });
});

describe('the route guard', () => {
  const run = async () => {
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
    const next = jest.fn();
    await refuseDisbandedTeam({ params: { id: 't1' } } as any, res, next);
    return { res, next };
  };
  test('a disbanded team answers 410 "This team was disbanded"', async () => {
    single = { deleted_at: '2026-09-27' };
    const { res, next } = await run();
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(TEAM_DISBANDED);
    expect(next).not.toHaveBeenCalled();
    expect(TEAM_DISBANDED).toEqual({ error: 'This team was disbanded', code: 'TEAM_DISBANDED' });
  });
  test('a live team passes through', async () => {
    single = { deleted_at: null };
    const { next } = await run();
    expect(next).toHaveBeenCalled();
  });
  test('it guards every team write and read except the team page, the three expense reads and withdrawing your own request', () => {
    const r = fs.readFileSync(path.join(__dirname, '..', 'routes', 'teams.routes.ts'), 'utf8');
    for (const route of [
      "router.get('/:id/insights'", "router.post('/:id/members'", "router.delete('/:id/members/:userId'",
      "router.get('/:id/bans'", "router.delete('/:id/bans/:userId'", "router.patch('/:id/members/:userId/role'",
      "router.patch('/:id'", "router.delete('/:id'", "router.post('/:id/join-requests'", "router.get('/:id/join-requests'",
      "router.patch('/:id/join-requests/:userId'", "router.post('/:id/expenses'", "router.patch('/:id/expenses/:expenseId'",
      "router.delete('/:id/expenses/:expenseId'",
    ]) {
      const line = r.split('\n').find((l) => l.startsWith(`${route},`));
      expect([route, !!line && line.includes('refuseDisbandedTeam')]).toEqual([route, true]);
    }
    for (const open of ["router.get('/:id',", "router.get('/:id/expenses',", "router.get('/:id/expenses/summary',", "router.get('/:id/expenses/log',", "router.delete('/:id/join-requests/me',"]) {
      const line = r.split('\n').find((l) => l.startsWith(open));
      expect([open, !!line && !line.includes('refuseDisbandedTeam')]).toEqual([open, true]);
    }
  });
});

describe('disband and the last member leaving are the soft disband', () => {
  test('captain: recorded as captain_disband; members and expenses untouched', () => {
    const f = fnBody(T, 'disbandTeam');
    expect(f).toMatch(/softDisbandTeam\(id, userId, 'captain_disband'\)/);
    expect(f).not.toMatch(/\.delete\(\)/);
  });
  test('last member: recorded as last_member_left; their row stays; a team with history is left empty as before', () => {
    const f = fnBody(T, 'removeTeamMember');
    expect(f).toMatch(/softDisbandTeam\(id, userId, 'last_member_left'\)[\s\S]*?team_disbanded: true/);
    expect(f).not.toMatch(/from\('teams'\)\.delete\(\)|from\('team_expenses'\)\.delete\(\)/);
    const i = f.indexOf("softDisbandTeam(id, userId, 'last_member_left')");
    const j = f.indexOf("team_empty: true");
    expect(f.slice(i, j)).toMatch(/\.from\('team_members'\)\s*\.delete\(\)/); // only on the kept-empty path
  });
});

describe('a disbanded team does not show', () => {
  test('lists (browse, Sport Hub, my teams) and the counts built from them', () => {
    expect(fnBody(T, 'listTeams')).toMatch(/query = liveTeams\(query\);/);
  });
  test('search', () => {
    const s = code('controllers/search.controller.ts');
    const i = s.indexOf('async function searchTeams');
    expect(s.slice(i, i + 900)).toMatch(/\.is\('deleted_at', null\)/);
  });
  test('its page: 410 "This team was disbanded", saying whether you were a member', () => {
    expect(fnBody(T, 'getTeam')).toMatch(/deleted_at\) \{\s*return res\.status\(410\)\.json\(\{\s*\.\.\.TEAM_DISBANDED,[\s\S]*?former_member: !!membership/);
  });
  test('pickers: a new match, a tournament entry (captain, by code, organiser adding) refuse it', () => {
    expect(fnBody('controllers/matches.controller.ts', 'createMatchRefusal')).toMatch(/t\.deleted_at\) return \{ status: 410, error: 'This team was disbanded\.', code: 'TEAM_DISBANDED' \}/);
    for (const fn of ['createEntry', 'joinByCode', 'directAddTeam']) {
      expect([fn, /isTeamDisbanded\(team_id\)\) return res\.status\(410\)\.json\(TEAM_DISBANDED\)/.test(fnBody('controllers/tournaments.controller.ts', fn))]).toEqual([fn, true]);
    }
  });
});

describe('nobody can join, invite or use its code', () => {
  test('the invite code', () => {
    expect(fnBody(T, 'joinTeamByCode')).toMatch(/deleted_at\) return res\.status\(410\)\.json\(TEAM_DISBANDED\)/);
  });
  test('no team invites or team chats exist to refuse (control: invites are for matches)', () => {
    const inv = code('controllers/invites.controller.ts');
    expect(inv).not.toMatch(/team/i);
    expect(inv).toMatch(/match/i);
  });
});

describe('what stays', () => {
  test('former members keep the expense history (reads unguarded, membership rows kept)', () => {
    expect(code('controllers/teamExpenses.controller.ts')).toMatch(/requireLedgerAccess/);
  });
  test('account deletion leaves a disbanded team\'s former members alone; the export marks it', async () => {
    const a = code('controllers/account.controller.ts');
    expect(a).toMatch(/const disbanded = await disbandedTeamIds\([\s\S]*?if \(disbanded\.has\(team_id as string\)\) continue;/);
    expect(a).toMatch(/team:teams\(id, name, short_name, sport_id, deleted_at\)/);
    rows = [{ id: 't9' }];
    expect([...(await disbandedTeamIds(['t9', 't9', '']))]).toEqual(['t9']);
  });
  test('team names are not unique, so a disbanded team blocks no name (control: venues do match on name)', () => {
    const dir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
    const all = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    expect(all).not.toMatch(/UNIQUE[^;\n]*teams[^;\n]*\(\s*(lower\()?name|teams[^;\n]*UNIQUE[^;\n]*\bname\b/i);
    expect(code(T)).not.toMatch(/name.*already (taken|exists|in use)/i);
    expect(all).toMatch(/ON venues \(lower\(name\)\)/);
  });
});

describe('migration 106', () => {
  test('schema only; nothing deleted', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '106_soft_disband_teams.sql'), 'utf8');
    expect(sql).toMatch(/ALTER TABLE teams ADD COLUMN IF NOT EXISTS deleted_at\s+timestamptz;/);
    expect(sql).toMatch(/deleted_reason IN \('captain_disband', 'last_member_left'\)/);
    expect(sql.replace(/--.*$/gm, '').replace(/ON DELETE SET NULL/g, '')).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
});
