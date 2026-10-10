/**
 * Phase 4 · K3 — teams + team-expense ledger regressions (SC-358/359/360/361).
 * Supabase is a recording chain: every from()/rpc() starts its own query, and
 * each resolves to `mockNext(q)`, where `q` lists that query's builder calls.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert']) {
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
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string) => start(`rpc:${n}`)) } };
});
let mockRole: string | null = 'player';
jest.mock('../utils/teamAuth', () => ({
  isTeamManager: jest.fn(async () => mockRole === 'captain' || mockRole === 'vice_captain'),
  isTeamCaptain: jest.fn(async () => mockRole === 'captain'),
  getTeamRole: jest.fn(async () => mockRole),
}));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => new Set()) }));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatsForTeam: jest.fn(), syncAfterSuccess: jest.fn() }));
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(), notifyUsers: jest.fn() }));
jest.mock('../utils/sports', () => ({ validateSportForCreate: jest.fn(async () => null) }));

// eslint-disable-next-line import/first
import { createTeam, removeTeamMember } from '../controllers/teams.controller';
// eslint-disable-next-line import/first
import { listExpenses, addExpense, deleteExpense, getExpenseSummary } from '../controllers/teamExpenses.controller';
// eslint-disable-next-line import/first
import { LIMITS } from '../utils/validation';

const ME = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const EXP = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const writesTo = (t: string) => mockLog.filter((q) => q[0] === `from:${t}` && q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
/** I am a member of TEAM (and OTHER is too), nobody is banned. */
const memberQ = (q: Q) => q[0] === 'from:team_members' && q.includes('maybeSingle');

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); mockRole = 'player'; });

describe('SC-358 · createTeam keeps join_policy', () => {
  it('K3-6 (42345b5): join_policy "approval" is written on insert; junk falls back to the column default', async () => {
    mockNext = (q) => (q[0] === 'from:teams' && q.includes('single') ? { data: { id: TEAM } } : { data: null });
    await call(createTeam, { body: { sport_id: 'cricket', name: 'Pune XI', join_policy: 'approval' } });
    const ins = mockLog.find((q) => q[0] === 'from:teams' && q.some((c) => c.startsWith('insert:')))!;
    expect(ins.join()).toContain('"join_policy":"approval"');
    mockLog = [];
    await call(createTeam, { body: { sport_id: 'cricket', name: 'Pune XI', join_policy: 'whatever' } });
    expect(mockLog.find((q) => q[0] === 'from:teams' && q.some((c) => c.startsWith('insert:')))!.join()).not.toContain('join_policy');
  });
});

describe('SC-359 · a voluntary leaver is not banned', () => {
  it('K3-7 (dd81760): a plain member leaving → removed, banned:false, no team_bans row', async () => {
    mockRole = 'player';
    mockNext = (q) => (q[0] === 'from:team_members' && q.some((c) => c.startsWith('delete:')) ? { data: [{ id: 'm1' }] } : { data: null });
    const r = await call(removeTeamMember, { params: { id: TEAM, userId: ME } });
    expect(r.body).toEqual({ removed: true, banned: false });
    expect(writesTo('team_bans')).toHaveLength(0);
  });
  it('K3-7 (dd81760): a captain removing someone else still bans them', async () => {
    mockRole = 'captain';
    mockNext = (q) => (q[0] === 'from:team_members' && q.some((c) => c.startsWith('delete:')) ? { data: [{ id: 'm1' }] } : { data: null });
    const r = await call(removeTeamMember, { params: { id: TEAM, userId: OTHER } });
    expect(r.body).toEqual({ removed: true, banned: true });
    expect(writesTo('team_bans')).toHaveLength(1);
  });
});

describe('SC-360 · the ledger is members-only', () => {
  it('K3-8a (916879b): a non-member gets 404 NOT_A_MEMBER on list, add, summary and delete — nothing written', async () => {
    mockNext = () => ({ data: null }); // no membership row
    for (const [fn, req] of [
      [listExpenses, { params: { id: TEAM } }],
      [addExpense, { params: { id: TEAM }, body: { title: 'Ground', amount: 100 } }],
      [getExpenseSummary, { params: { id: TEAM } }],
      [deleteExpense, { params: { id: TEAM, expenseId: EXP } }],
    ] as const) {
      const r = await call(fn, req);
      expect([r.statusCode, r.body.code]).toEqual([404, 'NOT_A_MEMBER']);
    }
    expect(mockLog.some((q) => q[0] === 'from:team_expenses')).toBe(false);
  });
  it('K3-8a (916879b): a banned member is refused too', async () => {
    mockNext = (q) => (memberQ(q) ? { data: { id: 'm' } } : q[0] === 'from:team_bans' ? { data: { id: 'b' } } : { data: null });
    const r = await call(listExpenses, { params: { id: TEAM } });
    expect([r.statusCode, r.body.code]).toEqual([404, 'NOT_A_MEMBER']);
  });
});

describe('SC-360 · who can delete', () => {
  const setup = (createdBy: string) => {
    mockNext = (q) => {
      if (memberQ(q)) return { data: { id: 'm' } };
      if (q[0] === 'from:team_expenses' && q.includes('maybeSingle')) return { data: { id: EXP, created_by: createdBy, title: 'Ground', amount: 100 } };
      return { data: null };
    };
  };
  it('K3-8b (916879b): a captain can delete an expense someone else logged', async () => {
    setup(OTHER); mockRole = 'captain';
    const r = await call(deleteExpense, { params: { id: TEAM, expenseId: EXP } });
    expect(r.body).toEqual({ success: true });
    expect(writesTo('team_expenses')).toHaveLength(1);
  });
  it('K3-8b (916879b): a plain member cannot delete someone else\'s → 403 NOT_EXPENSE_EDITOR', async () => {
    setup(OTHER); mockRole = 'player';
    const r = await call(deleteExpense, { params: { id: TEAM, expenseId: EXP } });
    expect([r.statusCode, r.body.code]).toEqual([403, 'NOT_EXPENSE_EDITOR']);
    expect(writesTo('team_expenses')).toHaveLength(0);
  });
});

describe('SC-360 · validation', () => {
  beforeEach(() => { mockNext = (q) => (memberQ(q) && q.some((c) => c.includes(`"user_id","${ME}"`)) ? { data: { id: 'm' } } : { data: null }); });
  it('K3-8d (916879b): the max amount is what the column holds — numeric(20,2) since migration 141, paise exact in JavaScript', () => {
    expect(LIMITS.expenseMaxAmount).toBe(90_000_000_000_000);
  });
  it.each([
    [{ title: 'Ground', amount: 90_000_000_000_001 }],
    [{ title: 'Ground', amount: 0.004 }],
    [{ title: 'Ground', amount: 100, category: 'kit' }],
    [{ title: '   ', amount: 100 }],
    [{ title: 'x'.repeat(121), amount: 100 }],
  ])('K3-8d (916879b): %j → 400, nothing inserted', async (body) => {
    const r = await call(addExpense, { params: { id: TEAM }, body });
    expect(r.statusCode).toBe(400);
    expect(writesTo('team_expenses')).toHaveLength(0);
  });
  it('K3-8d (916879b): paid_by a non-member → 400', async () => {
    const r = await call(addExpense, { params: { id: TEAM }, body: { title: 'Ground', amount: 100, paid_by: OTHER } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'paid_by must be a member of this team']);
    expect(writesTo('team_expenses')).toHaveLength(0);
  });
  it('K3-8e (916879b): a double-tapped add inside 15s returns the first row, deduplicated', async () => {
    const base = mockNext;
    mockNext = (q) => (q[0] === 'from:team_expenses' && q.includes('maybeSingle') ? { data: { id: EXP } } : base(q));
    const r = await call(addExpense, { params: { id: TEAM }, body: { title: 'Ground', amount: 100 } });
    expect(r.body).toEqual({ expense: { id: EXP }, deduplicated: true });
    expect(writesTo('team_expenses')).toHaveLength(0);
    const dq = mockLog.find((q) => q[0] === 'from:team_expenses')!.join();
    expect(dq).toContain('"title","Ground"');
    expect(dq).toContain('gte:["created_at"');
  });
});

describe('SC-360 · money is summed in paise', () => {
  it('K3-8c (916879b): ₹0.10 + ₹0.20 totals exactly 0.3', async () => {
    mockNext = (q) => (memberQ(q) ? { data: { id: 'm' } } : q[0] === 'from:team_expenses' ? { data: [{ amount: 0.1, split_among: [ME] }, { amount: 0.2, split_among: [ME] }] } : { data: null });
    const r = await call(getExpenseSummary, { params: { id: TEAM } });
    expect(r.body.total).toBe(0.3);
  });
});

describe('SC-361 · PostgREST\'s missing-table error does not block deletes', () => {
  it('K3-9 (326722a): the log insert failing with PGRST205 still lets the delete through', async () => {
    mockNext = (q) => {
      if (memberQ(q)) return { data: { id: 'm' } };
      if (q[0] === 'from:team_expenses' && q.includes('maybeSingle')) return { data: { id: EXP, created_by: ME, title: 'Ground', amount: 100 } };
      if (q[0] === 'from:team_expense_log') return { error: { code: 'PGRST205', message: "Could not find the table 'public.team_expense_log' in the schema cache" } };
      return { data: null };
    };
    const r = await call(deleteExpense, { params: { id: TEAM, expenseId: EXP } });
    expect(r.body).toEqual({ success: true });
  });
  it('K3-9 (326722a): a real log failure still refuses the delete', async () => {
    mockNext = (q) => {
      if (memberQ(q)) return { data: { id: 'm' } };
      if (q[0] === 'from:team_expenses' && q.includes('maybeSingle')) return { data: { id: EXP, created_by: ME, title: 'Ground', amount: 100 } };
      if (q[0] === 'from:team_expense_log') return { error: { code: '23505', message: 'duplicate key' } };
      return { data: null };
    };
    const r = await call(deleteExpense, { params: { id: TEAM, expenseId: EXP } });
    expect([r.statusCode, r.body.code]).toEqual([500, 'LOG_WRITE_FAILED']);
  });
});
