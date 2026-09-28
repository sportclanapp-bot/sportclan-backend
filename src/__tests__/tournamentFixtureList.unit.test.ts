/**
 * FORMATS (28 Sep, live): GET /matches?tournament_id=… returned nothing for a
 * tournament whose fixtures were drawn that morning. A list scoped to one
 * tournament was treated as discovery: voided fixtures were hidden, and so was
 * every fixture scheduled more than 6 hours ago. A tournament's fixtures are its
 * record, read like a team's history.
 */
const mockCalls: string[] = [];
jest.mock('../utils/supabase', () => {
  const q: any = {};
  for (const m of ['from', 'select', 'range', 'order', 'eq', 'or', 'is', 'in', 'gte', 'not', 'lt']) {
    q[m] = jest.fn((...a: unknown[]) => { mockCalls.push(`${m}:${JSON.stringify(a)}`); return q; });
  }
  q.then = (ok: (v: unknown) => unknown) => ok({ data: [], count: 0, error: null });
  return { supabase: q };
});
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), activeSportIds: jest.fn(async () => null) }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));

// eslint-disable-next-line import/first
import { shouldHideVoided } from '../utils/matchVoid';
// eslint-disable-next-line import/first
import { listMatches } from '../controllers/matches.controller';

const T = '22222222-2222-4222-8222-222222222222';
const list = async (query: Record<string, string>) => {
  mockCalls.length = 0;
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await listMatches({ userId: 'me', query } as any, r);
  return r;
};

describe("one tournament's fixture list", () => {
  it('is not a discovery read', () => {
    expect(shouldHideVoided({ tournamentScoped: true })).toBe(false);
    expect(shouldHideVoided({ status: 'scheduled', tournamentScoped: true })).toBe(false);
    expect(shouldHideVoided({})).toBe(true); // an unscoped list still is
  });

  it('keeps voided and earlier-today fixtures', async () => {
    const r = await list({ tournament_id: T });
    expect(r.statusCode).toBe(200);
    expect(mockCalls).toContain(`eq:["tournament_id","${T}"]`);
    expect(mockCalls.some((c) => c.startsWith('gte:["scheduled_at"'))).toBe(false);
    expect(mockCalls.some((c) => c.startsWith('is:["voided_at"'))).toBe(false);
  });

  it('an unscoped list still hides stale and voided fixtures', async () => {
    await list({});
    expect(mockCalls.some((c) => c.startsWith('gte:["scheduled_at"'))).toBe(true);
    expect(mockCalls.some((c) => c.startsWith('is:["voided_at"'))).toBe(true);
  });
});
