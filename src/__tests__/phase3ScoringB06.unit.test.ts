/**
 * Phase 3 · B06 Scoring (28 Sep 2026) — the backend fixes. See the app repo's
 * phase3/B06.md. Supabase is mocked: every `from()` starts its own query and
 * resolves to `mockNext(q)`, where `q` lists that query's builder calls.
 */
import fs from 'fs';
import path from 'path';

type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'gt', 'gte', 'lt', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
const mockPending = jest.fn(async () => ({ pending: false, opponentName: null as string | null }));
jest.mock('../utils/singles', () => ({ ...jest.requireActual('../utils/singles'), pendingRankedOpponent: (...a: unknown[]) => (mockPending as any)(...a) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'badminton' })) }));
const mockVerify = jest.fn();
jest.mock('../utils/qrHandoff', () => ({ ...jest.requireActual('../utils/qrHandoff'), verifyHandoff: (...a: unknown[]) => mockVerify(...a) }));
const mockRecord = jest.fn(async () => ({ event: { id: 'e' }, error: null, wasNew: true }));
jest.mock('../controllers/scoring.controller', () => ({
  ...jest.requireActual('../controllers/scoring.controller'),
  authorizeScorer: jest.fn(async () => ({ ok: true, match: MATCH })),
  recordEventIdempotent: (...a: unknown[]) => (mockRecord as any)(...a),
  recomputeSummary: jest.fn(async () => ({})),
}));

// eslint-disable-next-line import/first
import { uploadHandoff } from '../controllers/qrHandoff.controller';
// eslint-disable-next-line import/first
import { leaseRefusal } from '../utils/leaseCore';
// eslint-disable-next-line import/first
import { isKnownWicketType } from '../utils/cricketEventTypes';

const actual = jest.requireActual('../controllers/scoring.controller');
const MID = '11111111-1111-4111-8111-111111111111';
const SCORER = '22222222-2222-4222-8222-222222222222';
const MATCH: any = { id: MID, status: 'live', is_ranked: false, sport_id: 's', created_by: SCORER };

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const updates = () => mockLog.filter((q) => q.some((c) => c.startsWith('update:')));

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockRecord.mockClear();
  mockPending.mockClear();
  mockPending.mockImplementation(async () => ({ pending: false, opponentName: null }));
  MATCH.status = 'live';
});

describe('F1/F6 · validateScoringEvent', () => {
  const v = (ev: object, match: object = MATCH) => actual.validateScoringEvent(MID, match, ev);
  test.each([
    ['runs 99', { event_type: 'ball', payload: { team_side: 'A', runs: 99 } }],
    ['an unknown type', { event_type: 'run', payload: { team_side: 'A', runs: 4 } }],
    ['side "Z"', { event_type: 'ball', payload: { team_side: 'Z', runs: 1 } }],
    ['a string payload', { event_type: 'ball', payload: 'hello' }],
    ['a list payload', { event_type: 'ball', payload: [1, 2] }],
    ['a number payload', { event_type: 'ball', payload: 7 }],
    ['an unknown extra', { event_type: 'extra', payload: { team_side: 'A', type: 'ZZ', runs: 1 } }],
    ['an unknown dismissal', { event_type: 'wicket', payload: { team_side: 'A', wicket_type: 'teleported' } }],
  ])('%s → 400', async (_n, ev) => {
    expect((await v(ev))?.status).toBe(400);
  });
  test.each([
    { event_type: 'ball', payload: { team_side: 'A', runs: 4 } },
    { event_type: 'extra', payload: { team_side: 'A', type: 'Wd', runs: 1 } },
    { event_type: 'wicket', payload: { team_side: 'A', wicket_type: 'caught' } },
    { event_type: 'wicket', payload: { team_side: 'A', wicket_type: 'run_out' } },
    { event_type: 'wicket', payload: { team_side: 'A', wicket_type: 'retired_hurt' } },
    { event_type: 'wicket', payload: { team_side: 'A' } }, // an old wicket with no kind
    { event_type: 'score', payload: { team_side: 'B', value: 1 } },
  ])('a real event passes: %j', async (ev) => {
    expect(await v(ev)).toBeNull();
  });
  test('a ranked scheduled match whose opponent is pending → 409', async () => {
    mockPending.mockImplementation(async () => ({ pending: true, opponentName: 'Asha' }));
    const r = await v({ event_type: 'score', payload: { team_side: 'A', value: 1 } }, { ...MATCH, status: 'scheduled', is_ranked: true });
    expect(r).toMatchObject({ status: 409, body: { code: 'OPPONENT_NOT_ACCEPTED' } });
  });
  test('the dismissal list ignores case and punctuation, like isDismissal', () => {
    expect(isKnownWicketType('Hit Wicket')).toBe(true);
    expect(isKnownWicketType('retired-out')).toBe(true);
    expect(isKnownWicketType(3)).toBe(false);
  });
});

describe('F1 · a signed handoff goes through the same checks', () => {
  const op = (s: number, e: object) => ({ k: `k${s}`, s, t: 'event', e });
  const upload = async (ops: object[]) => {
    mockVerify.mockResolvedValue({ ok: true, payload: { v: 1, m: MID, d: 'dev', u: SCORER, n: `n${Math.random()}`, t: Date.now(), o: ops } });
    mockNext = (q) => (q[0] === 'from:matches' && q.some((c) => c.startsWith('maybeSingle')) ? { data: MATCH } : { data: null });
    const r = res();
    await uploadHandoff({ userId: 'courier', params: { id: MID }, body: { envelope: 'x' } } as any, r);
    return r;
  };
  test.each([
    ['runs 99', { event_type: 'ball', payload: { team_side: 'A', runs: 99 } }],
    ['an unknown type', { event_type: 'run', payload: { team_side: 'A', runs: 4 } }],
    ['side "Z"', { event_type: 'ball', payload: { team_side: 'Z', runs: 1 } }],
  ])('%s → 400 HANDOFF_OP_INVALID and NOTHING applied, not even the good op before it', async (_n, bad) => {
    const r = await upload([op(1, { event_type: 'ball', payload: { team_side: 'A', runs: 1 } }), op(2, bad)]);
    expect(r.statusCode).toBe(400);
    expect(r.body).toMatchObject({ code: 'HANDOFF_OP_INVALID', op: 2 });
    expect(mockRecord).not.toHaveBeenCalled();
  });
  test('a ranked match with a pending opponent is refused through the handoff too', async () => {
    MATCH.status = 'scheduled';
    mockPending.mockImplementation(async () => ({ pending: true, opponentName: null }));
    const r = await upload([op(1, { event_type: 'score', payload: { team_side: 'A', value: 1 } })]);
    expect(r.statusCode).toBe(400);
    expect(r.body.reason).toBe('OPPONENT_NOT_ACCEPTED');
    expect(mockRecord).not.toHaveBeenCalled();
  });
  test('a valid code still applies, and a first play promotes scheduled → live', async () => {
    MATCH.status = 'scheduled';
    const r = await upload([op(1, { event_type: 'ball', payload: { team_side: 'A', runs: 4 } })]);
    expect(r.body).toMatchObject({ status: 'uploaded', applied: 1 });
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(updates().some((q) => q.join(' ').includes('"status":"live"'))).toBe(true);
  });
});

describe('F2 · undoing the last event zeroes the score', () => {
  const existing = { A: { score: 1, points: 1 }, B: { score: 0 }, toss_winner_side: 'B' };
  beforeEach(() => {
    mockNext = (q) => {
      if (q[0] === 'from:matches' && q.some((c) => c.startsWith('maybeSingle'))) return { data: { sport_id: 's', score_summary: existing, format: null } };
      if (q[0] === 'from:match_events') return { data: [] };
      return { data: null };
    };
  });
  test('emptyMeansZero: the stored summary is the zero score (the toss survives)', async () => {
    const s = await actual.recomputeSummary(MID, { emptyMeansZero: true });
    expect(s.A.score).toBe(0);
    expect(s.B.score).toBe(0);
    const written = updates().find((q) => q[0] === 'from:matches')!.find((c) => c.startsWith('update:'))!;
    expect(JSON.parse(written.slice(7))[0].score_summary).toMatchObject({ A: { score: 0 }, B: { score: 0 }, toss_winner_side: 'B' });
  });
  test('a plain recompute with no events still keeps a seeded summary, and writes nothing', async () => {
    expect(await actual.recomputeSummary(MID)).toBe(existing);
    expect(updates()).toHaveLength(0);
  });
  test('undo and delete both ask for it', () => {
    expect(src('controllers/scoring.controller.ts')).toContain('recordScoreAfter(removed.auditId, await recomputeSummary(matchId, { emptyMeansZero: true }))');
    expect(src('controllers/matchFeatures.controller.ts')).toContain('const summary = await recomputeSummary(id, { emptyMeansZero: true });');
  });
});

describe('carried keys are written, not only returned', () => {
  test('a recompute with events keeps the toss in the STORED summary', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:matches' && q.some((c) => c.startsWith('maybeSingle'))) return { data: { sport_id: 's', score_summary: { toss_winner_side: 'A' }, format: null } };
      if (q[0] === 'from:match_events') return { data: [{ event_type: 'score', payload: { team_side: 'A', value: 1 } }] };
      return { data: null };
    };
    await actual.recomputeSummary(MID);
    const written = updates().find((q) => q[0] === 'from:matches')!.find((c) => c.startsWith('update:'))!;
    expect(JSON.parse(written.slice(7))[0].score_summary.toss_winner_side).toBe('A');
  });
});

describe('F5 · a finished match says so with a code', () => {
  test('createEvent, undo and the event edit/delete gate', () => {
    const s = src('controllers/scoring.controller.ts');
    expect(s).toContain("error: 'This match is finished and can no longer be scored', code: 'MATCH_FINISHED'");
    expect(s).toContain("error: 'This match is finished and can no longer be edited', code: 'MATCH_FINISHED'");
    expect(src('controllers/matchFeatures.controller.ts')).toContain("msg: 'This match is finished and can no longer be modified', code: 'MATCH_FINISHED'");
  });
});

describe('F7 · events list: bad limit or since is not a 500', () => {
  const list = async (query: object) => { const r = res(); await actual.listEvents({ userId: SCORER, params: { matchId: MID }, query } as any, r); return r; };
  const limitOf = () => mockLog[0]?.find((c) => c.startsWith('limit:'));
  test('limit -5 → the default 500', async () => {
    expect((await list({ limit: '-5' })).statusCode).toBe(200);
    expect(limitOf()).toBe('limit:[500]');
  });
  test('limit 20 → 20; limit 5000 → 1000', async () => {
    await list({ limit: '20' });
    expect(limitOf()).toBe('limit:[20]');
    mockLog = [];
    await list({ limit: '5000' });
    expect(limitOf()).toBe('limit:[1000]');
  });
  test.each([['garbage'], [['a', 'b']]])('since %j → 400', async (since) => {
    const r = await list({ since });
    expect(r.statusCode).toBe(400);
    expect(r.body).toEqual({ error: 'since must be a date' });
  });
});

describe('F11 · your own other phone is not "someone else"', () => {
  test('LEASE_LOST names the caller\'s own other phone', () => {
    expect(leaseRefusal({ code: 'LEASE_LOST', lease: { user_id: SCORER } }, SCORER).error).toBe('Your other phone is scoring this match.');
    expect(leaseRefusal({ code: 'LEASE_LOST', lease: { user_id: 'someone' } }, SCORER).error).toBe('Someone else took over scoring this match.');
  });
  test('every caller passes the user, and the claim 409 says it too', () => {
    const m = src('controllers/matches.controller.ts');
    expect(m.match(/leaseRefusal\(verdict, userId\)/g)).toHaveLength(2);
    expect(m).toContain("out.heldBy?.user_id === userId ? 'Your other phone is scoring this match.'");
  });
});
