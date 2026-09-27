/**
 * BE-2 items found in the B03 device check (27 Sep 2026).
 *  (a) the scorers leaderboard skips test matches for a real viewer, not just
 *      test scorers;
 *  (b) GET /users/discover resolves a sport slug instead of a 500.
 */
import fs from 'fs';
import path from 'path';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('(a) scorers leaderboard', () => {
  const src = () => code('controllers/insights.controller.ts');
  test('test matches are excluded for a real viewer, before counting', () => {
    const s = src();
    expect(s).toMatch(/if \(hideTest\) mq = excludeTest\(mq\);/);
    expect(s.indexOf('excludeTest(mq)')).toBeLessThan(s.indexOf('countMap.set'));
  });
  test('test scorers are still dropped too', () => {
    expect(src()).toMatch(/testScorers\.has\(m\.created_by as string\)/);
  });
});

describe('(b) discover players', () => {
  const fn = () => {
    const s = code('controllers/users.controller.ts');
    const i = s.indexOf('export async function discoverPlayers');
    return s.slice(i, s.indexOf('\nexport ', i + 10));
  };
  test('the sport is resolved (UUID or slug) before any query', () => {
    const f = fn();
    expect(f).toMatch(/const sport_id = await resolveSportId\(rawSport\);/);
    expect(f).toMatch(/if \(!sport_id\) return res\.status\(400\)\.json\(\{ error: 'Unknown sport_id' \}\)/);
    expect(f.indexOf('resolveSportId(rawSport)')).toBeLessThan(f.indexOf(".from('user_sport_profiles')"));
  });
});

describe('resolveSportId', () => {
  test('passes a UUID through and maps a slug', async () => {
    jest.resetModules();
    jest.doMock('../utils/supabase', () => ({
      supabase: {
        from: () => ({
          select: () => Promise.resolve({ data: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Cricket', slug: 'cricket' }], error: null }),
        }),
      },
    }));
    const { resolveSportId } = await import('../utils/sportId');
    expect(await resolveSportId('22222222-2222-4222-8222-222222222222')).toBe('22222222-2222-4222-8222-222222222222');
    expect(await resolveSportId('cricket')).toBe('11111111-1111-4111-8111-111111111111');
    expect(await resolveSportId('kabaddi-xyz')).toBeUndefined();
  });
});

describe('admin user list (admin device check)', () => {
  test('carries deleted_at so the app can mark a deleted account inside its 30-day window', () => {
    expect(code('controllers/admin.controller.ts')).toMatch(/const ADMIN_USER_FIELDS =\s*'[^']*\bdeleted_at\b[^']*'/);
  });
});
