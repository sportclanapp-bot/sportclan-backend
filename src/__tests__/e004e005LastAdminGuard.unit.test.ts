/**
 * E-004 / E-005 (Round 6): the last-admin guard asks whether an admin OTHER than
 * the target stays (a suspended admin's flag can be removed while an active one
 * remains), whitelisted admins (ADMIN_USER_IDS) count, show as admins in the
 * list, and their access can't be "removed" by clearing the column.
 * Same recording Supabase chain as phase3AdminB12.
 */
type Result = { data?: unknown; error?: unknown; count?: number | null };
let results: Result[] = [];
let queries: string[][] = [];
jest.mock('../utils/supabase', () => {
  const make = () => {
    const log: string[] = [];
    queries.push(log);
    const q: any = {};
    for (const m of ['select', 'insert', 'update', 'eq', 'neq', 'is', 'in', 'gte', 'order', 'range', 'or', 'not', 'limit']) {
      q[m] = jest.fn((...a: unknown[]) => { log.push(`${m}:${JSON.stringify(a)}`); return q; });
    }
    const next = () => results.shift() ?? { data: null, error: null, count: 0 };
    q.maybeSingle = jest.fn(async () => next());
    q.single = jest.fn(async () => next());
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, bad);
    return q;
  };
  return { supabase: { from: jest.fn((t: string) => { const q = make(); queries[queries.length - 1].push(`from:${t}`); return q; }) } };
});
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { Status: 'Success', Details: '10' } })) } }));
jest.mock('../utils/tournamentAuth', () => ({ logAdminAction: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { adminListUsers, adminUpdateUser } from '../controllers/admin.controller';

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: 'admin-1', params: {}, query: {}, body: {}, ...req }, r); return r; };

const WL = '11111111-1111-4111-8111-111111111111';
const ENV = process.env.ADMIN_USER_IDS;
beforeEach(() => { results = []; queries = []; delete process.env.ADMIN_USER_IDS; });
afterAll(() => { if (ENV === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = ENV; });

describe('E-004 · removing a suspended admin while an active one remains', () => {
  test('the count leaves out the target, so one other active admin is enough', async () => {
    // The target (u2) is a suspended admin; the caller is the one active admin.
    results = [{ data: { id: 'u2', is_admin: true, deleted_at: null } }, { count: 1 }, { data: { id: 'u2', is_admin: false } }];
    const r = await call(adminUpdateUser, { params: { id: 'u2' }, body: { is_admin: false } });
    expect(r.statusCode).toBe(200);
    expect(queries[1].join(' ')).toContain('neq:["id","u2"]');
  });
  test('no other active admin → still refused', async () => {
    results = [{ data: { id: 'u2', is_admin: true, deleted_at: null } }, { count: 0 }];
    const r = await call(adminUpdateUser, { params: { id: 'u2' }, body: { is_admin: false } });
    expect(r.statusCode).toBe(400);
    expect(r.body).toEqual({ error: 'Cannot remove the last remaining admin' });
  });
});

describe('E-005 · whitelisted admins', () => {
  test('the list shows a whitelisted admin as an admin, by settings', async () => {
    process.env.ADMIN_USER_IDS = WL;
    results = [{ data: [{ id: WL, is_admin: false }, { id: 'u3', is_admin: true }, { id: 'u4', is_admin: false }], count: 3 }];
    const r = await call(adminListUsers, {});
    expect(r.body.users).toEqual([
      { id: WL, is_admin: true, admin_by_settings: true },
      { id: 'u3', is_admin: true, admin_by_settings: false },
      { id: 'u4', is_admin: false, admin_by_settings: false },
    ]);
  });
  test('"Remove Admin" on a whitelisted admin is refused, nothing written', async () => {
    process.env.ADMIN_USER_IDS = WL;
    results = [{ data: { id: WL, is_admin: false, deleted_at: null } }];
    const r = await call(adminUpdateUser, { params: { id: WL }, body: { is_admin: false } });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('ADMIN_BY_SETTINGS');
    expect(queries.flat().some((q) => q.startsWith('update:'))).toBe(false);
  });
  test('the last-admin guard counts whitelisted admins', async () => {
    process.env.ADMIN_USER_IDS = `${WL}, not-a-uuid`;
    results = [{ data: { id: 'u2', is_admin: true, deleted_at: null } }, { count: 1 }, { data: { id: 'u2', is_admin: false } }];
    const r = await call(adminUpdateUser, { params: { id: 'u2' }, body: { is_admin: false } });
    expect(r.statusCode).toBe(200);
    expect(queries[1].join(' ')).toContain(`or:["is_admin.eq.true,id.in.(${WL})"]`);
  });
});
