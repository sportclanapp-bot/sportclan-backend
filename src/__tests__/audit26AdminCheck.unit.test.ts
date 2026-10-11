/** Audit #26 (11 Oct 2026): the tournament carve-outs read only users.is_admin, so an ADMIN_USER_IDS admin was refused there. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { userIsAdmin } from '../utils/tournamentAuth';

describe('audit #26: one admin answer', () => {
  const OLD = process.env.ADMIN_USER_IDS;
  afterAll(() => { process.env.ADMIN_USER_IDS = OLD; });
  it('a whitelisted admin is an admin in the tournament checks too', async () => {
    db = fakeDb({ users: [{ id: 'wl-admin', is_admin: false }, { id: 'db-admin', is_admin: true }, { id: 'nobody', is_admin: false }] });
    process.env.ADMIN_USER_IDS = 'wl-admin';
    expect(await userIsAdmin('wl-admin')).toBe(true);
    expect(await userIsAdmin('db-admin')).toBe(true);
    expect(await userIsAdmin('nobody')).toBe(false);
  });
});
