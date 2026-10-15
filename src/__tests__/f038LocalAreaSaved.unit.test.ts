/**
 * F038 (launch test plan): sign-up asks for "Local area (optional)" and the
 * answer was thrown away — never sent, and nowhere to keep it. Migration 159
 * adds users.local_area (≤ 80); sign-up stores it, PATCH /users/me edits it,
 * and both profiles (your own and someone else's) return it with the city.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const mockCalls: string[] = [];
let mockInsert: any = null;
let mockUpdate: any = null;
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'in', 'not', 'eq', 'neq', 'is', 'ilike', 'limit', 'maybeSingle', 'single', 'order']) {
    chain[m] = jest.fn((...a: unknown[]) => { mockCalls.push(`${m}:${JSON.stringify(a)}`); return chain; });
  }
  chain.insert = jest.fn((row: unknown) => { mockInsert = mockInsert ?? row; return chain; });
  chain.update = jest.fn((row: unknown) => { mockUpdate = row; return chain; });
  chain.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: null });
  return { supabase: chain };
});
const mockStore = new Map<string, { code: string; purpose: string }>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async () => undefined),
  getOtp: jest.fn(async (p: string) => mockStore.get(p) ?? null),
  deleteOtp: jest.fn(async () => undefined),
  bumpCounter: jest.fn(async () => 1),
  readCounter: jest.fn(async () => 0),
  clearCounter: jest.fn(async () => undefined),
}));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => { throw new Error('no network in tests'); }) } }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hash'), compare: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import * as auth from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { updateMe } from '../controllers/users.controller';

const ROOT = path.join(__dirname, '..', '..');
const res = () => {
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const signUp = async (extra: object) => {
  mockStore.set('+919876543210', { code: '482913', purpose: 'register' });
  const r = res();
  await auth.register({ body: { phone: '9876543210', code: '482913', name: 'Arjun', username: 'arjun_new', ...extra } } as any, r);
  return r;
};
beforeEach(() => { mockCalls.length = 0; mockInsert = null; mockUpdate = null; mockStore.clear(); });

describe('sign-up', () => {
  it('stores the local area (trimmed)', async () => {
    await signUp({ local_area: '  Kothrud ' });
    expect(mockInsert).toMatchObject({ local_area: 'Kothrud' });
  });
  it('an older app (no local_area) signs up as before', async () => {
    await signUp({});
    expect(mockInsert).toBeTruthy();
    expect(mockInsert).not.toHaveProperty('local_area');
  });
  it('a local area past 80 characters is refused, in words', async () => {
    const r = await signUp({ local_area: 'x'.repeat(81) });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Local area must be 80 characters or fewer');
    expect(mockInsert).toBeNull();
  });
});

describe('Edit profile', () => {
  it('PATCH /users/me saves it; empty clears it', async () => {
    const r = res();
    await updateMe({ userId: 'u1', body: { local_area: ' Baner ' } } as any, r);
    expect(r.statusCode).toBe(200);
    expect(mockUpdate).toMatchObject({ local_area: 'Baner' });
    const r2 = res();
    await updateMe({ userId: 'u1', body: { local_area: '' } } as any, r2);
    expect(mockUpdate).toMatchObject({ local_area: null });
  });
  it('refuses a too-long one', async () => {
    const r = res();
    await updateMe({ userId: 'u1', body: { local_area: 'y'.repeat(81) } } as any, r);
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_LOCAL_AREA']);
  });
});

describe('the profiles return it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'controllers', 'users.controller.ts'), 'utf8');
  it('your own and another person’s', () => {
    expect(src).toMatch(/const PUBLIC_FIELDS =\s*'[^']*\blocal_area\b/);
    expect(src).toMatch(/const PUBLIC_USER_FIELDS =\s*'[^']*\blocal_area\b/);
  });
});

describe('migration 159', () => {
  const RUNNER = `
import { PGlite } from '@electric-sql/pglite';
let s = ''; for await (const c of process.stdin) s += c;
const db = new PGlite(); const out = [];
for (const q of JSON.parse(s)) {
  try { const r = await db.exec(q); out.push({ rows: r.length ? r[r.length - 1].rows : [] }); }
  catch (e) { out.push({ error: e.message }); }
}
console.log('@@' + JSON.stringify(out));`;
  const pg = (steps: string[]): Array<{ rows?: any[]; error?: string }> => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER], { cwd: ROOT, input: JSON.stringify(steps), encoding: 'utf8', timeout: 120000 });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
    if (!line) throw new Error(`PGlite runner failed: ${r.stderr}`);
    return JSON.parse(line.slice(2));
  };
  it('adds users.local_area (≤ 80), safe to run twice', () => {
    const files = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter((f) => f.startsWith('159_'));
    expect(files).toHaveLength(1);
    const MIG = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', files[0]), 'utf8');
    const out = pg([
      `CREATE TABLE users (id int primary key);`,
      `CREATE TABLE teams (id uuid primary key, name text);`,
      `CREATE TABLE matches (id uuid primary key, status text, voided_at timestamptz, completed_at timestamptz, updated_at timestamptz, scheduled_at timestamptz, team_a_name text, team_b_name text, team_a_id uuid, team_b_id uuid, umpire_id uuid, tournament_id uuid);`,
      `CREATE TABLE match_participants (match_id uuid, user_id uuid, team_side text);`,
      MIG, MIG,
      `INSERT INTO users VALUES (1);`,
      `UPDATE users SET local_area = 'Kothrud' WHERE id = 1;`,
      `UPDATE users SET local_area = '${'z'.repeat(81)}' WHERE id = 1;`,
      `SELECT local_area FROM users WHERE id = 1;`,
    ]);
    expect(out.slice(0, 8).filter((o) => o.error)).toEqual([]);
    expect(out[8].error).toMatch(/users_local_area_len/);
    expect(out[9].rows).toEqual([{ local_area: 'Kothrud' }]);
  });
});
