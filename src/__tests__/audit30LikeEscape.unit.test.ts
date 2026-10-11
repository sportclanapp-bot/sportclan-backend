/** Audit #30 (11 Oct 2026): team search and the email check didn't escape % and _; the email check could be used to test many addresses. */
import { fakeDb } from './helpers/fakeSupabase';

const ctr = new Map<string, number>();
jest.mock('../utils/otpStore', () => ({
  bumpCounter: jest.fn(async (k: string) => { const n = (ctr.get(k) ?? 0) + 1; ctr.set(k, n); return n; }),
  readCounter: jest.fn(async (k: string) => ctr.get(k) ?? 0), clearCounter: jest.fn(), setOtp: jest.fn(), getOtp: jest.fn(), deleteOtp: jest.fn(),
}));
let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { updateMe, EMAIL_CHECKS_PER_DAY } from '../controllers/users.controller';

const call = async (email: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await updateMe({ userId: 'me', body: { email } } as any, r);
  return r;
};
describe('audit #30', () => {
  beforeEach(() => { ctr.clear(); db = fakeDb({ users: [{ id: 'me', email: 'me@x.com', deleted_at: null }, { id: 'other', email: 'ab1cd@x.com', deleted_at: null }] }); });
  it('an address with _ is not "taken" by a different address', async () => {
    const r = await call('ab_cd@x.com');
    expect(r.body?.code).not.toBe('EMAIL_TAKEN');
  });
  it(`after ${EMAIL_CHECKS_PER_DAY} tries a day, no more checks`, async () => {
    for (let i = 0; i < EMAIL_CHECKS_PER_DAY; i++) await call(`try${i}@x.com`);
    expect((await call('ab1cd@x.com')).statusCode).toBe(429);
  });
  it('team search escapes wildcards', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'controllers', 'teams.controller.ts'), 'utf8');
    expect(src).toContain("query.ilike('name', `%${escapeLike(String(q))}%`)");
  });
});
