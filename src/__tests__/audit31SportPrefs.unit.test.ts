/** Audit #31 (11 Oct 2026): sport-profile preferences took text of any length (and any type). */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
// eslint-disable-next-line import/first
import { updateSportProfile, SPORT_PREF_MAX } from '../controllers/users.controller';

const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await updateSportProfile({ userId: 'me', params: { sportId: 'cricket', id: 'me' }, body } as any, r);
  return r;
};
describe('audit #31: sport preferences are short labels', () => {
  beforeEach(() => { db = fakeDb({ sports: [{ id: 's-cr', slug: 'cricket', is_active: true }], user_sport_profiles: [] }); });
  it('a long text is refused', async () => {
    expect((await call({ batting_style: 'x'.repeat(SPORT_PREF_MAX + 1) })).body.code).toBe('PREFERENCE_TOO_LONG');
  });
  it('a non-text value is refused', async () => {
    expect((await call({ batting_style: { a: 1 } })).body.code).toBe('BAD_PREFERENCE');
  });
  it('a normal label is fine', async () => {
    expect((await call({ batting_style: 'Right-hand bat' })).statusCode).not.toBe(400);
  });
});
