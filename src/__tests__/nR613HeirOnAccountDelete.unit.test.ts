/** Round 6 · N-R6-13: deleting the only admin of a group left the group with no admin (nobody could manage it). */
import fs from 'fs';
import path from 'path';
import { mock } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
// eslint-disable-next-line import/first
import { handGroupsToHeirsOnDelete } from '../utils/chatHeirsOnDelete';

const ME = 'u-deleted';
let chat: Record<string, unknown> = { id: 'g1', is_group: true, deleted_at: null };
let otherAdmins: unknown[] = []; let tournamentChat = false;
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    const sel = q.find((c) => c.startsWith('select')) ?? '';
    if (q[0] === 'from:chat_participants' && q.some((c) => c.startsWith('update'))) return { data: null };
    if (q[0] === 'from:chat_participants' && sel.includes('chat_id')) return { data: [{ chat_id: 'g1' }] };
    if (q[0] === 'from:chats') return { data: [chat] };
    if (q[0] === 'from:tournaments') return { data: tournamentChat ? [{ id: 't1' }] : [] };
    if (q[0] === 'from:chat_participants' && q.some((c) => c.includes('"role","admin"')) && q.some((c) => c.startsWith('neq'))) return { data: otherAdmins };
    if (q[0] === 'from:chat_participants') return { data: { user_id: 'oldest-member' } };
    return { data: null };
  };
});
const promoted = () => mock.log.filter((q) => q[0] === 'from:chat_participants' && q.some((c) => c.startsWith('update')));

test('the only admin is deleted: the oldest member becomes admin', async () => {
  otherAdmins = []; tournamentChat = false; chat = { id: 'g1', is_group: true, deleted_at: null };
  expect(await handGroupsToHeirsOnDelete(ME)).toBe(1);
  expect(promoted()[0].join()).toContain('oldest-member');
});
test('another admin remains, a DM, or a tournament chat: nobody is promoted', async () => {
  otherAdmins = [{ user_id: 'x' }]; expect(await handGroupsToHeirsOnDelete(ME)).toBe(0);
  otherAdmins = []; chat = { id: 'g1', is_group: false, deleted_at: null }; expect(await handGroupsToHeirsOnDelete(ME)).toBe(0);
  chat = { id: 'g1', is_group: true, deleted_at: null }; tournamentChat = true; expect(await handGroupsToHeirsOnDelete(ME)).toBe(0);
  expect(promoted()).toHaveLength(0);
});
test('Delete account runs it after the captaincy hand-over', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/account.controller.ts'), 'utf8');
  expect(src.indexOf('handGroupsToHeirsOnDelete(userId)')).toBeGreaterThan(src.indexOf("rpc('finalize_captaincy_on_delete'"));
});
