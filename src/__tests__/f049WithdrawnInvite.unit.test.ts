/**
 * F049 (launch test plan, Round 4) · accepting an invite its sender had just
 * withdrawn answered 'You already answered this invite.' — false, and the app kept
 * it as pending. It now says it was withdrawn (INVITE_WITHDRAWN).
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(), notifyUser: jest.fn(), notifyUsers: jest.fn() }));
// eslint-disable-next-line import/first
import { respondToInvite } from '../controllers/invites.controller';

const call = async (status: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await respondToInvite({ userId: 'd', params: { id: 'i1' }, body: { status } } as any, r);
  return r;
};
const invite = (status: string) => ({ id: 'i1', sender_id: 'c', receiver_id: 'd', sport_id: 's', status, created_at: new Date().toISOString() });

it('a withdrawn invite says it was withdrawn, not that you answered it', async () => {
  db = fakeDb({ invites: [invite('withdrawn')] });
  const r = await call('accepted');
  expect(r.statusCode).toBe(409);
  expect(r.body).toEqual({ error: 'They withdrew this invite.', code: 'INVITE_WITHDRAWN' });
});

it('one you did answer still says so', async () => {
  db = fakeDb({ invites: [invite('declined')] });
  const r = await call('accepted');
  expect(r.body).toEqual({ error: 'You already answered this invite.', code: 'INVITE_RESOLVED' });
});

it('a pending one is answered', async () => {
  db = fakeDb({ invites: [invite('pending')], users: [{ id: 'd', name: 'D' }] });
  const r = await call('accepted');
  expect(r.statusCode).toBe(200);
  expect(db.tables.invites[0]!.status).toBe('accepted');
});
