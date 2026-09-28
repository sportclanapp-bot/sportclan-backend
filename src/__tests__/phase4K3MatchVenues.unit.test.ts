/**
 * Phase 4 · K3 — match team names and venue normalisation (SC-366/367/368).
 * Supabase is a recording chain: every from()/rpc() starts its own query and
 * resolves to mockNext(q).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const done = () => ({ data: null, error: null, ...mockNext(q) });
    chain.single = jest.fn(async () => { q.push('single'); return done(); });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); return done(); });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(done())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, args?: unknown) => start(`rpc:${n}:${JSON.stringify(args ?? null)}`)) } };
});
jest.mock('../utils/testContent', () => ({
  ...jest.requireActual('../utils/testContent'),
  hideTestFor: jest.fn(async () => false),
  excludeTest: jest.fn((q: unknown) => q),
}));

// eslint-disable-next-line import/first
import { attachTeamNames } from '../utils/teamNames';
// eslint-disable-next-line import/first
import { normaliseVenue, VENUE_TOO_LONG, LIMITS } from '../utils/validation';
// eslint-disable-next-line import/first
import { updateMatch } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { createVenue, searchVenues } from '../controllers/venues.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const TA = '22222222-2222-4222-8222-222222222222';
const TB = '33333333-3333-4333-8333-333333333333';
const M = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('SC-366 · team-vs-team matches carry real names', () => {
  it('K3-11 (5a1818a): a registered side with no team_x_name gets the team\'s name; a free-text opponent keeps its label', async () => {
    mockNext = (q) => (q[0] === 'from:teams' ? { data: [{ id: TA, name: 'Pune XI', short_name: 'PXI' }, { id: TB, name: 'Mumbai Mavericks', short_name: null }] } : {});
    const rows: any[] = [
      { team_a_id: TA, team_b_id: TB, team_a_name: null, team_b_name: null },
      { team_a_id: TA, team_b_id: null, team_a_name: null, team_b_name: "Rahul's XI" },
    ];
    await attachTeamNames(rows);
    expect([rows[0].team_a_name, rows[0].team_b_name]).toEqual(['Pune XI', 'Mumbai Mavericks']);
    expect([rows[1].team_a_name, rows[1].team_b_name]).toEqual(['Pune XI', "Rahul's XI"]);
  });
  it('K3-11 (5a1818a): the list and detail handlers run it', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync(require('path').join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
    const body = (name: string) => src.slice(src.indexOf(`export async function ${name}(`), src.indexOf('\nexport ', src.indexOf(`export async function ${name}(`) + 10));
    expect(body('listMatches')).toMatch(/attachTeamNames\(matches\)/);
    expect(body('getMatch')).toMatch(/attachTeamNames\(\[matchWithRating\]\)/);
  });
});

describe('SC-367 · venue text is normalised on create AND edit', () => {
  it('K3-13 (d143946): over the cap is VENUE_TOO_LONG; the cap is 120', () => {
    expect(LIMITS.venueMax).toBe(120);
    expect(normaliseVenue('v'.repeat(121))).toBe(VENUE_TOO_LONG);
    expect(normaliseVenue('v'.repeat(120))).toBe('v'.repeat(120));
  });
  const creatorMatch = (q: Q) => (q[0] === 'from:matches' && q.includes('maybeSingle')
    ? { data: { created_by: ME, umpire_id: null, status: 'upcoming', team_a_id: null, team_b_id: null, tournament_id: null, sport_id: 'x', is_open: false } }
    : null);
  it('K3-13 (d143946): PATCH /matches/:id with a 121-char venue → 400 VENUE_TOO_LONG, nothing written', async () => {
    mockNext = (q) => creatorMatch(q) ?? {};
    const r = await call(updateMatch, { params: { id: M }, body: { venue: 'v'.repeat(121) } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'VENUE_TOO_LONG']);
    expect(mockLog.some((q) => q.some((c) => c.startsWith('update:')))).toBe(false);
  });
  it('K3-13 (d143946): PATCH /matches/:id stores a trimmed venue', async () => {
    mockNext = (q) => creatorMatch(q) ?? { data: { id: M } };
    await call(updateMatch, { params: { id: M }, body: { venue: '  Shivaji Park  ' } });
    const u = mockLog.find((q) => q[0] === 'from:matches' && q.some((c) => c.startsWith('update:')));
    expect(u?.join()).toContain('"venue":"Shivaji Park"');
  });
});

describe('SC-368 · the venue directory', () => {
  it('K3-15 (7a543ff): POST /venues with a whitespace-only name → 400, nothing saved', async () => {
    const r = await call(createVenue, { body: { name: '    ' } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'name is required']);
    expect(mockLog.filter((q) => q[0] === 'from:venues' || q[0].startsWith('rpc:'))).toHaveLength(0);
  });
  it('K3-15 (7a543ff): POST /venues with a 121-char name → 400 VENUE_TOO_LONG', async () => {
    const r = await call(createVenue, { body: { name: 'v'.repeat(121) } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'VENUE_TOO_LONG']);
  });
  it('K3-16 (9264b54): the directory pages (default 30, offset honoured) and says has_more', async () => {
    mockNext = () => ({ data: Array.from({ length: 30 }, (_, i) => ({ id: `v${i}` })) });
    const r = await call(searchVenues, {});
    expect(mockLog[0].join()).toContain('range:[0,29]');
    expect(r.body.has_more).toBe(true);
    expect(r.body.venues).toHaveLength(30);
    mockLog = [];
    await call(searchVenues, { query: { limit: '50', offset: '100' } });
    expect(mockLog[0].join()).toContain('range:[100,149]');
    expect(mockLog[0].join()).not.toContain('limit:[10]');
  });
});
