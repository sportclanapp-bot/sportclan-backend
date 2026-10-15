/**
 * F042 (launch test plan) · muting a 201st chat failed with "muted_chats must be a
 * list of ids." — the wrong reason — and mutes of chats you had left or that were
 * deleted were never taken out, so they filled the 200 for good. The limit stays
 * (anti-abuse, kept by Dipak); old mutes no longer count, and a full list says so.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => id(from + i));
const live = (chatId: string, userId = 'me') => ({ chat_id: chatId, user_id: userId, left_at: null, chat: { deleted_at: null } });

const mockDb = { client: null as any };
jest.mock('../utils/supabase', () => ({ get supabase() { return mockDb.client; } }));
// eslint-disable-next-line import/first
import { notificationPrefsProblem, notificationPrefsRefusal, pruneMutedChats, MUTED_MAX } from '../controllers/users.controller';

describe('the refusal', () => {
  it('a full list says the limit in plain words, with its own code', () => {
    expect(MUTED_MAX).toBe(200);
    expect(notificationPrefsRefusal({ muted_chats: ids(1, 201) }))
      .toEqual({ error: 'You can mute up to 200 chats. Unmute one to mute this chat.', code: 'MUTE_LIMIT' });
    expect(notificationPrefsRefusal({ muted_teams: ids(1, 201) })?.error).toBe('You can mute up to 200 teams. Unmute one to mute this team.');
  });
  it('200 is fine; a bad id is still "a list of ids"', () => {
    expect(notificationPrefsRefusal({ muted_chats: ids(1, 200) })).toBeNull();
    expect(notificationPrefsRefusal({ muted_chats: ['x'] })).toEqual({ error: 'muted_chats must be a list of ids.', code: 'INVALID_NOTIFICATION_PREFS' });
    expect(notificationPrefsProblem({ muted_chats: ids(1, 201) })).toMatch(/up to 200 chats/);
  });
});

describe('old mutes no longer fill the list', () => {
  it('chats you left or that were deleted are dropped when the list is over the limit', async () => {
    const all = ids(1, 201);
    const rows = all.map((c) => live(c));
    rows[0] = { ...rows[0], left_at: '2026-10-01T00:00:00Z' } as any; // left
    rows[1] = { ...rows[1], chat: { deleted_at: '2026-10-01T00:00:00Z' } } as any; // deleted
    mockDb.client = fakeDb({ chat_participants: [...rows, live(all[2], 'someone-else')] }).client;
    const out = await pruneMutedChats('me', { chat: true, muted_chats: all }) as any;
    expect(out.chat).toBe(true);
    expect(out.muted_chats).toHaveLength(199);
    expect(out.muted_chats).not.toContain(all[0]);
    expect(out.muted_chats).not.toContain(all[1]);
    expect(notificationPrefsRefusal(out)).toBeNull();
  });
  it('a list within the limit is left as sent (no look-up)', async () => {
    mockDb.client = { from: jest.fn(() => { throw new Error('no look-up expected'); }) };
    const prefs = { muted_chats: ids(1, 3) };
    expect(await pruneMutedChats('me', prefs)).toBe(prefs);
  });
  it('201 live chats stay 201 — and are refused as full', async () => {
    const all = ids(1, 201);
    mockDb.client = fakeDb({ chat_participants: all.map((c) => live(c)) }).client;
    const out = await pruneMutedChats('me', { muted_chats: all });
    expect(notificationPrefsRefusal(out)?.code).toBe('MUTE_LIMIT');
  });
});
