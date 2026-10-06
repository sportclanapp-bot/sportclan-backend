/**
 * Phase 4 · D1 — the rest of the doc-recorded backend bugs fixed in non-fix
 * commits. Pure helpers and small handlers are called with a mocked Supabase;
 * wiring that lives deep inside a large controller is pinned on its source
 * (comments stripped), the way reportableWall / leaveOnlyOpen do it.
 */
import fs from 'fs';
import path from 'path';

type Res = { data?: unknown; error?: unknown };
let mockTable: Record<string, Res | ((log: string[]) => Res)> = {};
let mockWrites: string[] = [];
jest.mock('../utils/supabase', () => {
  const make = (table: string) => {
    const log: string[] = [];
    const q: any = {};
    for (const m of ['select', 'eq', 'neq', 'is', 'in', 'gt', 'order', 'range', 'or', 'not', 'limit']) {
      q[m] = jest.fn((...a: unknown[]) => { log.push(`${m}:${JSON.stringify(a)}`); return q; });
    }
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      q[m] = jest.fn((...a: unknown[]) => { log.push(`${m}:${JSON.stringify(a)}`); mockWrites.push(`${table}.${m}`); return q; });
    }
    const result = (): Res => {
      const t = mockTable[table];
      return (typeof t === 'function' ? t(log) : t) ?? { data: null, error: null };
    };
    q.single = jest.fn(async () => result());
    q.maybeSingle = jest.fn(async () => result());
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
    return q;
  };
  return { supabase: { from: jest.fn((t: string) => make(t)), rpc: jest.fn(() => make('rpc')) } };
});

jest.mock('../utils/jwt', () => ({
  ...jest.requireActual('../utils/jwt'),
  verifyAccessToken: jest.fn((t: string) => { if (t !== 'good') throw new Error('bad'); return { userId: '11111111-1111-4111-8111-111111111111' }; }),
}));
// eslint-disable-next-line import/first
import { attachTeamNames } from '../utils/teamNames';
// eslint-disable-next-line import/first
import { updateMySports } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { optionalAuth } from '../middleware/auth.middleware';
// eslint-disable-next-line import/first
import usersRouter from '../routes/users.routes';

const ME = '11111111-1111-4111-8111-111111111111';
const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fnBody = (f: string, name: string) => {
  const s = code(f);
  const i = s.indexOf(`function ${name}(`);
  expect(i).toBeGreaterThan(-1);
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};

beforeEach(() => { mockTable = {}; mockWrites = []; });

describe('B19b (15b1940) · GET /users/:id knows the viewer', () => {
  test('B19b (15b1940): the /:id route runs optionalAuth before getUserById', () => {
    const layer = (usersRouter as any).stack.find((l: any) => l.route?.path === '/:id' && l.route.methods.get);
    expect(layer).toBeTruthy();
    const names = layer.route.stack.map((s: any) => s.handle.name);
    expect(names).toEqual(['optionalAuth', 'getUserById']);
  });

  test('B19b (15b1940): optionalAuth sets userId from a valid token and lets an anonymous call through', () => {
    const next = jest.fn();
    const anon: any = { headers: {} };
    optionalAuth(anon, {} as any, next);
    expect(anon.userId).toBeUndefined();
    const req: any = { headers: { authorization: 'Bearer good' } };
    optionalAuth(req, {} as any, next);
    expect(req.userId).toBe(ME);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('TEAM-NAMES (07de5ca) · registered teams are named on match rows', () => {
  test('TEAM-NAMES (07de5ca): a match between registered teams gets their names and short names, not "Team A/B"', async () => {
    mockTable = { teams: { data: [{ id: 'ta', name: 'Kings', short_name: 'KNG' }, { id: 'tb', name: 'Lions', short_name: null }] } };
    const m: any = { team_a_id: 'ta', team_b_id: 'tb', team_a_name: null, team_b_name: null };
    const free: any = { team_a_id: 'ta', team_b_id: null, team_a_name: null, team_b_name: "Rahul's XI" };
    await attachTeamNames([m, free]);
    expect(m).toMatchObject({ team_a_name: 'Kings', team_b_name: 'Lions', team_a_short_name: 'KNG', team_b_short_name: null });
    expect(free.team_b_name).toBe("Rahul's XI");
  });
});

describe('SC-365 (36305b8) · the sports you play are editable', () => {
  test('SC-365 (36305b8): PATCH /users/me/sports rewrites user_sports with active sports only', async () => {
    // the fake returns the inactive sport too unless the query asks for is_active
    mockTable = { sports: (log) => ({ data: log.some((c) => c.includes('is_active')) ? [{ id: 's1' }] : [{ id: 's1' }, { id: 'kabaddi' }] }), user_sports: { data: null, error: null } };
    const r = res();
    await updateMySports({ userId: ME, body: { sport_ids: ['s1'] } } as any, r);
    expect(r.body).toEqual({ sport_ids: ['s1'] });
    expect(mockWrites).toEqual(['user_sports.delete', 'user_sports.insert']);
    mockWrites = [];
    const bad = res();
    await updateMySports({ userId: ME, body: { sport_ids: ['s1', 'kabaddi'] } } as any, bad);
    expect([bad.statusCode, bad.body.code]).toEqual([400, 'INVALID_SPORT']);
    expect(mockWrites).toEqual([]);
  });
});

describe('teams (61a2439, c6c8449, afd5f1b)', () => {
  const teams = () => code('controllers/teams.controller.ts');
  test('SC-359 (61a2439): list and detail strip the join code for anyone who is not a member', () => {
    expect(teams()).toMatch(/isMember: boolean\): T \{\s*if \(isMember\) return team;\s*const \{ join_code: _omit, \.\.\.rest \} = team;\s*return rest as T;/);
    expect(teams()).toContain('const row = stripJoinCode(t, myIds.has(t.id));');
    expect(teams()).toContain('team: stripJoinCode(team as any, viewerIsMember)');
  });
  test('SC-267 (c6c8449): a captain who leaves hands the team to the co-captain before the oldest member', () => {
    expect(teams()).toMatch(/const heir = \(list\.find\(\(m\) => m\.role === 'vice_captain'\)\?\.user_id\s*\?\? list\[0\]\?\.user_id\)/);
  });
  test('SILENT-ADD (afd5f1b): adding a member tells them', () => {
    expect(teams()).toMatch(/notifyUnlessBlocked\(userId, \{\s*userId: user_id,\s*type: 'added_to_team',/);
    expect(code('controllers/features.controller.ts')).toMatch(/notifyUnlessBlocked\(userId, \{\s*userId: user_id,\s*type: 'assigned_as_official',/);
  });
});

describe('notifications and schedules', () => {
  test('APPROVAL-NOTIFS (1f874c1): answering a play invite tells its sender (tournament entries: phase3TournamentsB08 › entry_requested)', () => {
    expect(fnBody('controllers/invites.controller.ts', 'respondToInvite')).toMatch(/userId: data\.sender_id,\s*type: accepted \? 'invite_accepted' : 'invite_declined',/);
  });
  test('Z-2a (a60b7e1): the 15-minute reminder runs on a 5-minute in-process timer, not only from GET /users/me', () => {
    const idx = code('index.ts');
    expect(idx).toMatch(/const \{ sent \} = await runMatchReminderSweep\(\);/);
    expect(idx).toContain('setInterval(runReminders, 5 * 60 * 1000).unref();');
  });
  test('SC-316 (8d21c22): badges are evaluated on the events that earn them', () => {
    for (const f of ['controllers/community.controller.ts', 'controllers/users.controller.ts', 'controllers/gifts.controller.ts', 'controllers/tournaments.controller.ts', 'controllers/matches.controller.ts']) {
      expect(code(f)).toMatch(/awardBadgesSafe\(|awardGiftBadge\(/);
    }
  });
});

describe('stats and money', () => {
  test('SC-424 (abf8174): cricket career stats read innings only from the user\'s unvoided matches', () => {
    const sp = fnBody('controllers/users.controller.ts', 'getSportProfile');
    expect(sp).toMatch(/\.from\('innings_stats'\)[\s\S]{0,300}\.eq\('user_id', id\)\s*\.in\('match_id', matchIds\.slice\(0, 500\)\)/);
    expect(sp).toContain("match:matches!inner(id, voided_at, sport_id, status)");
  });
  test('SC-434a (76633b5): kudos coins go through awardCoins (ledgered, idempotent), not read-add-write', () => {
    const k = code('controllers/kudos.controller.ts');
    expect(k).toContain("await awardCoins(toUserId, `kudos_${inserted.id}`, KUDOS_COINS, 'Received kudos');");
    expect(k).not.toMatch(/coin_balance:\s*\(/);
  });
  test('SC-283 (46f0095): a casual match with two real players counts matches played; ELO stays ranked-only', () => {
    const m = code('controllers/matches.controller.ts');
    // Oct 2026: `unplayed` — a walkover; a retirement was played and counts.
    expect(m).toContain('if (!match.is_ranked && !unplayed && participants && participants.length >= 2) {');
    expect(m).toContain('casualAttribution = true;');
  });
  test('SC-25 / Z-5b (da69331, 86aaed4): standings rows carry team_name / team_id, the diff and the sport', () => {
    const f = fnBody('controllers/features.controller.ts', 'getTournamentStandings');
    expect(f).toMatch(/team_name: \(r as any\)\.team,/);
    expect(f).toMatch(/team_id: \(r as any\)\.teamId,/);
    expect(f).toContain('diff: s.diff');
    expect(f).toContain('sportSlug: sport?.slug ?? null');
  });
  test('SC-200 (eadabf7): the profile reads the real city through the cities join', () => {
    expect(fnBody('controllers/users.controller.ts', 'getMe')).toContain('city:cities!city_id(id, name)');
    expect(fnBody('controllers/users.controller.ts', 'getUserById')).toContain('city:cities!city_id(id, name)');
  });
  test('SC-28 (15f74bb): /services pages with a stable order instead of the implicit ~1000-row cap', () => {
    const s = code('routes/services.routes.ts');
    expect(s).toMatch(/\.order\('user_id', \{ ascending: true \}\)\s*\.range\(p\.from, p\.to\);/);
    expect(s).toContain('return res.json({ providers, ...pageMeta(count, p) });');
  });
});
