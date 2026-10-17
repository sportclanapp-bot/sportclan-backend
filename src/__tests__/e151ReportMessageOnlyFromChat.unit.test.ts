/**
 * Round 6 · E-151: a chat message could be reported by anyone with its id, member of the chat or
 * not — and the report puts the message's private text in the moderators' queue. Now only someone
 * who is (or was) in that chat can report it; to anyone else it is not found.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(), notifyUser: jest.fn(), notifyUnlessBlocked: jest.fn() }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));
// eslint-disable-next-line import/first
import { reportContent } from '../controllers/community.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const SENDER = '22222222-2222-4222-8222-222222222222';
const MSG = '44444444-4444-4444-8444-444444444444';
const CHAT = '55555555-5555-4555-8555-555555555555';
let seats: Array<{ id: string; left_at?: string | null }> = [];
const reports = () => mock.log.filter((q) => q[0] === 'from:content_reports' && q.some((c) => c.startsWith('insert')));
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:messages') return { data: { sender_id: SENDER, chat_id: CHAT } };
    if (q[0] === 'from:chat_participants') return { data: seats };
    if (q[0] === 'from:content_reports' && q.some((c) => c.startsWith('insert'))) return { data: { id: 'r1' } };
    return { data: null };
  };
});
const report = async () => {
  const r = res();
  await reportContent({ userId: ME, body: { target_type: 'message', target_id: MSG, reason: 'abuse' } } as any, r);
  return r;
};

test('someone never in the chat: 404, no report', async () => {
  seats = [];
  const r = await report();
  expect(r.statusCode).toBe(404);
  expect(reports()).toHaveLength(0);
});
test('a member can report it', async () => {
  seats = [{ id: 's1', left_at: null }];
  expect((await report()).statusCode).toBe(201);
  expect(reports()).toHaveLength(1);
});
test('a member who has since left can still report it', async () => {
  seats = [{ id: 's1', left_at: '2026-10-01T00:00:00Z' }];
  expect((await report()).statusCode).toBe(201);
  const seatQuery = mock.log.find((q) => q[0] === 'from:chat_participants')!;
  expect(seatQuery.some((c) => c.includes('left_at'))).toBe(false);
});
