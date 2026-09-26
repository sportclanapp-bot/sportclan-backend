/**
 * Visual review B03 (V245 + V016, V031, V090, V091, V096, V103, V227; decision D3)
 * · test content is hidden from real users until the launch wipe deletes it.
 *
 * The rule is one helper (utils/testContent.ts) and one line at every public
 * discovery read. These pin both: the helper's decisions, and that each of the
 * reads found in the sweep actually calls it.
 */
import fs from 'fs';
import path from 'path';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ── the helper, against a fake supabase ───────────────────────────────────
const state: { columnMissing: boolean; viewer: Record<string, boolean | 'error'> } = { columnMissing: false, viewer: {} };
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      let id: string | undefined;
      const q: any = {
        select: () => q,
        limit: () => Promise.resolve(state.columnMissing ? { data: null, error: { code: '42703' } } : { data: [], error: null }),
        eq: (_c: string, v: string) => { id = v; return q; },
        maybeSingle: () => {
          const v = id ? state.viewer[id] : undefined;
          if (v === 'error') return Promise.resolve({ data: null, error: { message: 'x' } });
          return Promise.resolve({ data: v === undefined ? null : { is_test_seed: v }, error: null });
        },
      };
      return q;
    },
  },
}));
// eslint-disable-next-line import/first
import { hideTestFor, __resetTestContentCaches } from '../utils/testContent';

beforeEach(() => {
  __resetTestContentCaches();
  state.columnMissing = false;
  state.viewer = { real: false, qa: true, broken: 'error' };
});

describe('hideTestFor · who has test rows filtered out', () => {
  it('a real account: filtered', async () => expect(await hideTestFor('real')).toBe(true));
  it('a test account (the QA devices): sees everything, so they keep working', async () =>
    expect(await hideTestFor('qa')).toBe(false));
  it('signed out: filtered', async () => expect(await hideTestFor(undefined)).toBe(true));
  it('the viewer lookup failed: filtered (the safe side)', async () => expect(await hideTestFor('broken')).toBe(true));
  it('migration 097 not applied yet: nothing filtered — the old behaviour, no broken query', async () => {
    state.columnMissing = true;
    expect(await hideTestFor('real')).toBe(false);
  });
});

describe('every public discovery read applies it', () => {
  const sites: Array<[string, RegExp]> = [
    ['controllers/search.controller.ts', /const hide = await hideTestFor\(callerId\);/],
    ['controllers/search.controller.ts', /excludeIds\(excludeDeleted\(noTest\(base, hide\)\), 'id', blocked\)/], // players
    ['controllers/search.controller.ts', /async function searchTeams[\s\S]*?await noTest\(query, hide\)/],
    ['controllers/search.controller.ts', /async function searchTournaments[\s\S]*?await noTest\(query, hide\)/],
    ['controllers/search.controller.ts', /if \(hide\) query = excludeTestEmbed\(excludeTest\(query\), 'author'\);/], // posts
    ['controllers/users.controller.ts', /if \(await hideTestFor\(userId\)\) usersQ = excludeTest\(usersQ\);/], // discover
    ['controllers/features.controller.ts', /if \(await hideTestFor\(userId\)\) nearbyQ = excludeTest\(nearbyQ\);/],
    ['controllers/features.controller.ts', /profiles\.filter\(\(p\) => !testIds\.has\(p\.user_id as string\)\)/], // player of week
    ['controllers/community.controller.ts', /if \(!viewingOwn && \(await hideTestFor\(req\.userId\)\)\) q = excludeTestEmbed\(excludeTest\(q\), 'author'\);/],
    ['controllers/community.controller.ts', /if \(await hideTestFor\(req\.userId\)\) query = excludeTestEmbed\(excludeTest\(query\), 'author'\);/], // story counts
    ['controllers/community.controller.ts', /if \(await hideTestFor\(req\.userId\)\) cq = excludeTestEmbed\(cq, 'author'\);/], // comments
    ['controllers/community.controller.ts', /if \(await hideTestFor\(req\.userId\)\) mentionQ = excludeTest\(mentionQ\);/],
    ['controllers/matches.controller.ts', /if \(!mine && !team_id && !tournament_id && \(await hideTestFor\(userId\)\)\) query = excludeTest\(query\);/],
    ['controllers/matches.controller.ts', /if \(await hideTestFor\(userId\)\) query = excludeTest\(query\);/], // open matches
    ['controllers/teams.controller.ts', /else if \(await hideTestFor\(userId\)\) query = excludeTest\(query\);/],
    ['controllers/tournaments.controller.ts', /else if \(await hideTestFor\(userId\)\) query = excludeTest\(query\);/],
    ['controllers/leaderboard.controller.ts', /if \(hideTest\) qb = qb\.eq\('tu\.is_test_seed', false\);/],
    ['controllers/leaderboard.controller.ts', /const testMonthly = await testUserIdSet/],
    ['controllers/insights.controller.ts', /testScorers\.has\(m\.created_by as string\)/],
    ['routes/services.routes.ts', /if \(await hideTestFor\(req\.userId\)\) q = excludeTestEmbed\(q, 'users'\);/],
    ['controllers/venues.controller.ts', /if \(await hideTestFor\(req\.userId\)\) query = excludeTest\(query\);/],
    ['controllers/seasons.controller.ts', /if \(hideTest\) higherQ = higherQ\.eq\('tu\.is_test_seed', false\);/],
  ];
  it.each(sites)('%s', (file, re) => expect(code(file)).toMatch(re));

  it('the leaderboard filters in the query, so page, total and ranks agree', () => {
    const l = code('controllers/leaderboard.controller.ts');
    expect((l.match(/withTU\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it('the player-of-week cache keeps separate real and test answers', () => {
    expect(code('controllers/features.controller.ts')).toMatch(/const cacheKey = hide \? 'real' : 'test';/);
  });
});

describe('the migration and the flagging script', () => {
  const sql = (f: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', f), 'utf8');
  it('097 is idempotent and covers the six root tables plus venues', () => {
    const m = sql('migrations/097_test_seed_flag.sql');
    for (const t of ['users', 'teams', 'matches', 'tournaments', 'community_posts', 'chats', 'venues']) {
      expect(m).toMatch(new RegExp(`ALTER TABLE ${t}\\s+ADD COLUMN IF NOT EXISTS is_test_seed boolean NOT NULL DEFAULT false;`));
    }
  });
  it('APPLY-b03 counts before it writes and deletes nothing', () => {
    const a = sql('checks/APPLY-b03-flag-test-content.sql');
    expect(a.indexOf('BLOCK 1 · COUNT FIRST')).toBeLessThan(a.indexOf('UPDATE users'));
    expect(a).not.toMatch(/\bDELETE\b/);
  });
});
