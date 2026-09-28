/**
 * Phase 4 · K1 (backend fix commits) — SC-90/91/92/93: every calendar boundary
 * resolves in IST, whatever the host timezone (Render runs UTC). Before, the
 * post count, the monthly leaderboard and the post-coin day used server-local
 * midnight, so 00:00–05:30 IST fell into the previous day/month.
 */
import fs from 'fs';
import path from 'path';

const mockGte: string[] = [];
jest.mock('../utils/supabase', () => {
  const make = () => {
    const q: any = {};
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) q[m] = jest.fn(() => q);
    q.gte = jest.fn((_c: string, v: string) => { mockGte.push(v); return q; });
    q.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: null, count: 0 });
    return q;
  };
  return { supabase: { from: jest.fn(() => make()) } };
});

// eslint-disable-next-line import/first
import { istDay, istDayStartIso, istMonthStartIso } from '../utils/appTime';
// eslint-disable-next-line import/first
import { getMyPostCount } from '../controllers/community.controller';

const fnBody = (rel: string, head: string) => {
  const s = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const i = s.indexOf(head);
  return s.slice(i, s.indexOf('\n}\n', i));
};
// 01:30 IST on 1 Aug 2026 is still 31 Jul in UTC — the window the bug lived in.
const EARLY_IST = new Date('2026-07-31T20:00:00.000Z');

afterEach(() => { jest.useRealTimers(); mockGte.length = 0; });

describe('SC-93 · the shared IST helpers', () => {
  test('K1-74d (b29913e): day and month start are the IST midnight as a UTC instant', () => {
    expect(istDay(EARLY_IST)).toBe('2026-08-01');
    expect(istDayStartIso(EARLY_IST)).toBe('2026-07-31T18:30:00.000Z');
    expect(istMonthStartIso(EARLY_IST)).toBe('2026-07-31T18:30:00.000Z');
    expect(istMonthStartIso(new Date('2026-07-15T10:00:00Z'))).toBe('2026-06-30T18:30:00.000Z');
  });
});

describe('SC-90 · the post count counts the IST month', () => {
  test('K1-74a (b29913e): at 01:30 IST on the 1st, the count starts at IST midnight on the 1st', async () => {
    jest.useFakeTimers({ now: EARLY_IST, doNotFake: ['nextTick', 'setImmediate'] });
    const r: any = { statusCode: 200, status: jest.fn(() => r), json: jest.fn((b: unknown) => { r.body = b; return r; }) };
    await getMyPostCount({ userId: 'u1' } as any, r);
    expect(mockGte.length).toBeGreaterThan(0);
    for (const v of mockGte) expect(v).toBe('2026-07-31T18:30:00.000Z');
    // Host-local midnight equals IST midnight on an IST laptop, so the value
    // alone can't tell the two apart there — pin the helper too.
    const f = fnBody('controllers/community.controller.ts', 'export async function getMyPostCount');
    expect(f).toContain('const startOfMonth = istMonthStartIso();');
    expect(f).not.toMatch(/setHours\(0, 0, 0, 0\)/);
  });
});

describe('SC-91/92 · the monthly leaderboard and the post-coin day use the same helpers', () => {
  test('K1-74b (b29913e): monthly leaderboard window starts at istMonthStartIso', () => {
    const f = fnBody('controllers/leaderboard.controller.ts', 'export async function getLeaderboard');
    expect(f).toContain('const startOfMonth = istMonthStartIso(now);');
    expect(f).not.toMatch(/new Date\(now\.getFullYear\(\), now\.getMonth\(\), 1\)/);
  });
  test('K1-74c (b29913e): the daily post-coin bucket is keyed and bounded by the IST day', () => {
    const f = fnBody('controllers/community.controller.ts', 'export async function createPost');
    expect(f).toContain('const today = istDay();');
    expect(f).toContain(".gte('created_at', istDayStartIso())");
    expect(f).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });
});
