/**
 * E-064 (Round 6): `force` on a hub takeover means "the holder hands over", but nothing checked the
 * caller WAS the holder — any organiser could take a live venue desk from the phone running it by
 * sending force:true.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
// eslint-disable-next-line import/first
import { takeOverHub } from '../controllers/tournamentHub.controller';
// eslint-disable-next-line import/first
import { mayTakeOver, STALE_AFTER_MS } from '../utils/leaseCore';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HOLDER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_ORGANISER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let live: { user_id: string; device_id: string; heartbeat_at: string; claimed_at: string };
beforeEach(() => {
  mock.log = [];
  live = { user_id: HOLDER, device_id: 'phone-1', heartbeat_at: new Date().toISOString(), claimed_at: new Date().toISOString() };
  mock.next = (q) => {
    if (q[0] === 'from:tournaments') return { data: { created_by: HOLDER, parent_id: null } };
    if (q[0] === 'from:tournament_organisers') return { data: [{ user_id: OTHER_ORGANISER }] };
    if (q[0] === 'from:tournament_hub_leases') return { data: q.some((c) => c.startsWith('upsert')) ? { ...live, user_id: OTHER_ORGANISER } : live };
    return { data: null };
  };
});
const req = (userId: string, body: object) => ({ userId, params: { id: T }, body, header: (h: string) => (h === 'x-device-id' ? 'phone-2' : undefined) }) as any;
const writes = () => mock.log.filter((q) => q.some((c) => /^(upsert|update|insert|delete):/.test(c)));

test('another organiser sending force:true does not take a live hub (409 HUB_ACTIVE, nothing written)', async () => {
  const r = res();
  await takeOverHub(req(OTHER_ORGANISER, { reason: 'mine now', force: true }), r);
  expect(r.statusCode).toBe(409);
  expect(r.body.code).toBe('HUB_ACTIVE');
  expect(writes()).toHaveLength(0);
});
test('the holder may still move it to another of their phones with force', async () => {
  const r = res();
  await takeOverHub(req(HOLDER, { reason: 'new phone', force: true }), r);
  expect(r.statusCode).toBe(200);
});
test('the rule: stale or unheld → yes; live → only the holder, with force', () => {
  const now = Date.now();
  const fresh = { user_id: HOLDER, heartbeat_at: new Date(now).toISOString() };
  const stale = { user_id: HOLDER, heartbeat_at: new Date(now - STALE_AFTER_MS).toISOString() };
  expect(mayTakeOver(null, OTHER_ORGANISER, {}, now)).toBe(true);
  expect(mayTakeOver(stale, OTHER_ORGANISER, {}, now)).toBe(true);
  expect(mayTakeOver(fresh, OTHER_ORGANISER, {}, now)).toBe(false);
  expect(mayTakeOver(fresh, OTHER_ORGANISER, { force: true }, now)).toBe(false);
  expect(mayTakeOver(fresh, HOLDER, { force: true }, now)).toBe(true);
  expect(mayTakeOver(fresh, HOLDER, {}, now)).toBe(false);
});
