/** Round 6 · N-R6-11: a voided match's result could be shared to the Community feed as a match result. */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(), notifyUser: jest.fn(), notifyUnlessBlocked: jest.fn() }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));
// eslint-disable-next-line import/first
import { createPost } from '../controllers/community.controller';

const ME = '11111111-1111-4111-8111-111111111111'; const MATCH = '55555555-5555-4555-8555-555555555555';
let voidedAt: string | null = null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rpc = (require('../utils/supabase').supabase.rpc = jest.fn(() => ({ single: async () => ({ data: { id: 'p1' }, error: null }) })));
beforeEach(() => {
  mock.log = []; rpc.mockClear();
  mock.next = (q) => (q[0] === 'from:matches' ? { data: { id: MATCH, status: 'completed', created_by: ME, voided_at: voidedAt } } : { data: null });
});
const share = async () => { const r = res(); await createPost({ userId: ME, body: { content: 'We won', post_type: 'match_result', match_id: MATCH }, header: () => undefined } as any, r); return r; };
test('a voided match: 409 MATCH_VOIDED and no post', async () => {
  voidedAt = '2026-10-17T10:00:00Z';
  const r = await share();
  expect(r.statusCode).toBe(409);
  expect(r.body.code).toBe('MATCH_VOIDED');
  expect(rpc).not.toHaveBeenCalled();
});
test('a counted match is not refused for that reason', async () => {
  voidedAt = null;
  const r = await share();
  expect(r.body?.code).not.toBe('MATCH_VOIDED');
  expect(rpc).toHaveBeenCalled();
});
