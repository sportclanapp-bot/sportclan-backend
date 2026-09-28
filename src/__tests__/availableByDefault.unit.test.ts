/**
 * "Available to play" is ON for a new account; existing accounts keep theirs.
 * register sets is_available: true and returns it (so the app's Profile toggle
 * shows it straight after sign-up), and migration 113 moves the column default
 * to true without touching existing rows (run on PGlite, in-process Postgres).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const mockCalls: string[] = [];
let mockInsert: any = null;
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'in', 'not', 'eq', 'neq', 'is', 'ilike', 'limit', 'maybeSingle', 'single', 'update', 'order']) {
    chain[m] = jest.fn((...a: unknown[]) => { mockCalls.push(`${m}:${JSON.stringify(a)}`); return chain; });
  }
  chain.insert = jest.fn((row: unknown) => { mockInsert = mockInsert ?? row; return chain; });
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
// Nothing here may reach an SMS provider.
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => { throw new Error('no network in tests'); }) } }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hash'), compare: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import * as auth from '../controllers/auth.controller';

const ROOT = path.join(__dirname, '..', '..');
const RUNNER = `
import { PGlite } from '@electric-sql/pglite';
let s = ''; for await (const c of process.stdin) s += c;
const db = new PGlite(); const out = [];
for (const q of JSON.parse(s)) {
  try { const r = await db.exec(q); out.push({ rows: r.length ? r[r.length - 1].rows : [] }); }
  catch (e) { out.push({ error: e.message }); }
}
console.log('@@' + JSON.stringify(out));`;
function pg(steps: string[]): Array<{ rows?: any[]; error?: string }> {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER], { cwd: ROOT, input: JSON.stringify(steps), encoding: 'utf8', timeout: 120000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`PGlite runner failed: ${r.stderr}`);
  return JSON.parse(line.slice(2));
}

describe('Available to play for new accounts', () => {
  beforeEach(() => { mockCalls.length = 0; mockInsert = null; mockStore.clear(); });

  it('register creates the account with is_available: true and returns it', async () => {
    mockStore.set('+919876543210', { code: '482913', purpose: 'register' });
    const r: any = { statusCode: 200 };
    r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
    r.json = jest.fn((b: unknown) => { r.body = b; return r; });
    await auth.register({ body: { phone: '9876543210', code: '482913', name: 'Arjun', username: 'arjun_new' } } as any, r);
    expect(mockInsert).toMatchObject({ is_available: true });
    const select = mockCalls.filter((c) => c.startsWith('select:')).find((c) => c.includes('referral_code, '));
    expect(select).toMatch(/\bis_available\b/);
  });

  it('migration 113: new rows default to available; existing rows keep their value', () => {
    const mig012 = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '012_availability_streaks_challenges.sql'), 'utf8');
    const col = /ALTER TABLE users ADD COLUMN IF NOT EXISTS is_available[^;]*;/.exec(mig012)![0];
    const out = pg([
      'CREATE TABLE users (id serial PRIMARY KEY, name text)',
      col,
      "INSERT INTO users (name) VALUES ('old default')",
      "INSERT INTO users (name, is_available) VALUES ('old on', true)",
      fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '113_is_available_default_true.sql'), 'utf8'),
      "INSERT INTO users (name) VALUES ('new')",
      'SELECT name, is_available FROM users ORDER BY id',
    ]);
    expect(out.filter((s) => s.error)).toEqual([]);
    expect(out[6]!.rows).toEqual([
      { name: 'old default', is_available: false },
      { name: 'old on', is_available: true },
      { name: 'new', is_available: true },
    ]);
  });
});
