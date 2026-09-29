/**
 * BUILD 2.5 · the offline pack and the QR handoff carry the rules. A handoff's
 * `ru` (the rules the scorer's phone played by) must match the match's own —
 * they're fixed once play starts — or nothing is applied (409 RULES_MISMATCH).
 * A code from an older app carries none and is taken as before.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal', 'like', 'not', 'csv']) {
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
const MATCH = '22222222-2222-4222-8222-222222222222';
let mockRu: unknown;
jest.mock('../utils/qrHandoff', () => ({
  ...jest.requireActual('../utils/qrHandoff'),
  verifyHandoff: jest.fn(async () => ({ ok: true, payload: {
    v: 1, m: '22222222-2222-4222-8222-222222222222', d: 'dev', u: 'scorer', n: 'nonce-25', t: Date.now(),
    o: [{ k: '55555555-5555-4555-8555-555555555555', s: 1, t: 'result', r: { w: '33333333-3333-4333-8333-333333333333' } }],
    ...(mockRu ? { ru: mockRu } : {}),
  } })),
}));
jest.mock('../controllers/scoring.controller', () => ({
  authorizeScorer: jest.fn(async () => ({ ok: true, match: { id: 'm', status: 'live' } })),
  recordEventIdempotent: jest.fn(), recomputeSummary: jest.fn(async () => null), validateScoringEvent: jest.fn(async () => null), promoteToLive: jest.fn(),
}));
jest.mock('../controllers/matches.controller', () => ({ completeMatch: jest.fn(async (_q: unknown, res: any) => res.json({ match: { id: 'm' } })) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'badminton' })) }));
jest.mock('../utils/discrepancy', () => ({
  checkResultBeforeRecording: jest.fn(async () => ({ disagrees: false })),
  checkAndRecordDiscrepancy: jest.fn(async () => ({ disagrees: false })),
  recordUnsentPlayForFinalMatch: jest.fn(),
}));

// eslint-disable-next-line import/first
import fs from 'fs';
// eslint-disable-next-line import/first
import path from 'path';
// eslint-disable-next-line import/first
import { uploadHandoff } from '../controllers/qrHandoff.controller';
// eslint-disable-next-line import/first
import { looksWellFormed } from '../utils/qrHandoff';

const upload = async () => {
  mockNext = (q) => (q[0] === 'from:matches' && q.some((c) => c.includes('winner_team_id')) ? { data: { status: 'live', winner_team_id: null } }
    : q[0] === 'from:matches' ? { data: { id: MATCH, status: 'live', sport_id: 's', voided_at: null, format: 'bo3', overs: null, rules: null } } : { data: null });
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await uploadHandoff({ userId: 'courier', params: { id: MATCH }, body: { envelope: {} }, headers: {} } as any, r);
  return r;
};
beforeEach(() => { mockLog = []; mockRu = undefined; });

describe('BUILD 2.5 · the handoff carries the rules', () => {
  it('rules that differ from the match’s → 409 RULES_MISMATCH, nothing written', async () => {
    mockRu = { v: 1, bestOf: 1, target: 21, cap: 30, finalTarget: null, winBy2: true };
    const r = await upload();
    expect([r.statusCode, r.body.code]).toEqual([409, 'RULES_MISMATCH']);
    expect(mockLog.some((q) => q.some((c) => /^(insert|update|upsert)/.test(c)))).toBe(false);
  });
  it('the same rules (any key order) → applied', async () => {
    mockRu = { winBy2: true, bestOf: 3, target: 21, cap: 30, finalTarget: null, v: 1 };
    const r = await upload();
    expect(r.body.code).not.toBe('RULES_MISMATCH');
    expect(r.statusCode).toBe(200);
  });
  it('an older code without rules is taken as before', async () => {
    const r = await upload();
    expect(r.statusCode).toBe(200);
  });
  it('a malformed rules field makes the envelope malformed', () => {
    const p = { v: 1, m: 'x', d: 'd', u: 'u', n: 'n', t: Date.now(), o: [{ k: '55555555-5555-4555-8555-555555555555', s: 1, t: 'result', r: { w: null } }] };
    expect(looksWellFormed({ sig: 's', p })).toBe(true);
    expect(looksWellFormed({ sig: 's', p: { ...p, ru: 'bo1' } })).toBe(false);
  });
  it('the offline pack carries each fixture’s rules and the tournament’s stage rules', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/tournamentHub.controller.ts'), 'utf8');
    expect(src).toContain('next_match_id, next_slot, overs, format, rules, umpire_id, updated_at');
    expect(src).toContain('created_by, updated_at, match_rules');
  });
});
