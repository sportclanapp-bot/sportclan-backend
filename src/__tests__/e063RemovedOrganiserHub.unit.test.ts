/**
 * E-063 (Round 6): a co-organiser removed while their phone ran the venue desk kept heartbeating
 * it (heartbeatHub never asked whether they still organise), so the lease never went quiet and the
 * remaining organisers were told "another phone is running this".
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
// eslint-disable-next-line import/first
import { heartbeatHub, takeOverHub } from '../controllers/tournamentHub.controller';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REMOVED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const lease = () => ({ tournament_id: T, user_id: REMOVED, device_id: 'phone-1', heartbeat_at: new Date().toISOString(), claimed_at: new Date().toISOString() });
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:tournaments') return { data: { created_by: CREATOR, parent_id: null } };
    if (q[0] === 'from:tournament_organisers') return { data: [] }; // REMOVED is no longer a co-organiser
    if (q[0] === 'from:tournament_hub_leases') return { data: q.some((c) => c.startsWith('upsert')) ? { ...lease(), user_id: CREATOR } : lease() };
    return { data: null };
  };
});
const req = (userId: string, body: object = {}, device = 'phone-1') => ({ userId, params: { id: T }, body, header: (h: string) => (h === 'x-device-id' ? device : undefined) }) as any;
const writes = () => mock.log.filter((q) => q[0] === 'from:tournament_hub_leases' && q.some((c) => /^(upsert|update|insert|delete):/.test(c)));

test('a removed co-organiser’s heartbeat is refused and keeps nothing warm', async () => {
  const r = res();
  await heartbeatHub(req(REMOVED), r);
  expect(r.statusCode).toBe(403);
  expect(r.body.code).toBe('NOT_AN_ORGANISER');
  expect(writes()).toHaveLength(0);
});
test('the creator can take the desk from them at once (it is still fresh)', async () => {
  const r = res();
  await takeOverHub(req(CREATOR, { reason: 'They’re no longer an organiser' }, 'phone-9'), r);
  expect(r.statusCode).toBe(200);
  expect(r.body.lease.user_id).toBe(CREATOR);
});
