/**
 * Visual review B13 (backend) · notifications and messaging.
 * V014 @username search · V216 the void notice reads like a person wrote it ·
 * V009 filter counts for the whole inbox · V066/D18 chat pushes behind a
 * "Chat messages" switch, and per-team mute · notification_preferences shape.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../utils/supabase', () => ({ supabase: {} }));
// eslint-disable-next-line import/first
import { voidNoticeBody } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { chatPushText, dueForPush, pushRecipients, QUIET_MS } from '../utils/chatPush';
// eslint-disable-next-line import/first
import { mutedChat, mutedFor } from '../utils/notify';
// eslint-disable-next-line import/first
import { notificationPrefsProblem } from '../controllers/users.controller';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('V216 · the void notice', () => {
  it('quotes the reason as the voider’s words', () => {
    expect(voidNoticeBody('Lions vs Tigers', 'Priya', 'rain stopped play'))
      .toBe('Lions vs Tigers no longer counts. Priya voided it: “rain stopped play”.');
    expect(voidNoticeBody('Lions vs Tigers', null, '')).toBe('Lions vs Tigers no longer counts. The organiser voided it.');
  });
  it('no "Reason:" system line remains', () => {
    expect(code('controllers/matches.controller.ts')).not.toMatch(/Reason: \$\{reason\}/);
  });
});

describe('V009 · filter counts for the whole inbox', () => {
  it('returns per-type counts and whether they are complete', () => {
    const n = code('controllers/notifications.controller.ts');
    expect(n).toMatch(/type_counts: typesRes\.error \? null : typeCounts/);
    expect(n).toMatch(/type_counts_complete: !typesRes\.error && \(count \?\? 0\) <= TYPE_COUNT_CAP/);
  });
});

describe('D18 · chat pushes', () => {
  it('DM: the sender is the title; group: "name: text", trimmed', () => {
    expect(chatPushText({ isGroup: false, chatName: null, senderName: 'Priya', text: 'see you at 6' }))
      .toEqual({ title: 'Priya', body: 'see you at 6' });
    const g = chatPushText({ isGroup: true, chatName: 'Lions', senderName: 'Priya', text: 'x'.repeat(200) });
    expect(g.title).toBe('Lions');
    expect(g.body.startsWith('Priya: ')).toBe(true);
    expect(g.body.length).toBeLessThanOrEqual(7 + 90);
  });
  it('at most one push per chat per person in the quiet window', () => {
    const t0 = 1_000_000;
    expect(dueForPush('c1', ['a', 'b'], t0)).toEqual(['a', 'b']);
    expect(dueForPush('c1', ['a'], t0 + 1000)).toEqual([]);
    expect(dueForPush('c2', ['a'], t0 + 1000)).toEqual(['a']); // another chat
    expect(dueForPush('c1', ['a'], t0 + QUIET_MS + 1)).toEqual(['a']);
  });
  it('is sent on every message', () => {
    expect(code('controllers/messages.controller.ts')).toMatch(/void pushChatMessage\(id, userId,/);
    expect(code('utils/notify.ts')).toMatch(/chat_message: 'chat'/);
  });
  it('an @mention keeps its own path: not behind the Chat messages switch', () => {
    const n = code('utils/notify.ts');
    expect(n).not.toMatch(/mention_in_chat:/); // no category → always delivered
    const m = code('controllers/messages.controller.ts');
    expect(m).toMatch(/supabase\.from\('notifications'\)\.insert\(\{\s*user_id: u\.id,\s*type: 'mention_in_chat'/);
  });
});

describe('who a chat message pushes to', () => {
  const all = async (ids: string[]) => ids;
  const base = { senderId: 's', memberIds: ['s', 'a', 'b', 'c'], blocked: new Set<string>(), deleted: new Set<string>(), flagged: new Set<string>() };
  it('never the sender', async () => {
    expect(await pushRecipients(base, all)).toEqual(['a', 'b', 'c']);
  });
  it('nobody blocked either way, no deleted account', async () => {
    expect(await pushRecipients({ ...base, blocked: new Set(['a']), deleted: new Set(['b']) }, all)).toEqual(['c']);
  });
  it('a test account never reaches a real one (dipak, reviewer, any real user)', async () => {
    expect(await pushRecipients({ ...base, flagged: new Set(['s', 'b']) }, all)).toEqual(['b']);
    // a real sender reaches test accounts as before
    expect(await pushRecipients({ ...base, flagged: new Set(['b']) }, all)).toEqual(['a', 'b', 'c']);
  });
  it('then the prefs (Chat messages off, muted chat) decide', async () => {
    expect(await pushRecipients(base, async (ids) => ids.filter((u) => u !== 'c'))).toEqual(['a', 'b']);
  });
  it('left and deleted chats: members are read with left_at null, and a deleted chat stops it', () => {
    const c = code('utils/chatPush.ts');
    expect(c).toMatch(/from\('chat_participants'\)\.select\('user_id'\)\.eq\('chat_id', chatId\)\.is\('left_at', null\)/);
    expect(c).toMatch(/if \(!chat \|\| \(chat as \{ deleted_at\?: string \| null \}\)\.deleted_at\) return;/);
  });
  it('per-chat mute', () => {
    expect(mutedChat({ muted_chats: ['c1'] }, 'c1')).toBe(true);
    expect(mutedChat({ muted_chats: ['c1'] }, 'c2')).toBe(false);
    expect(mutedChat(undefined, 'c1')).toBe(false);
    expect(code('utils/notify.ts')).toMatch(/category === 'chat' && ctx\?\.chatId && mutedChat\(prefs, ctx\.chatId\)/);
  });
});

describe('D18 · per-team mute', () => {
  it('a muted team is skipped', () => {
    expect(mutedFor({ muted_teams: ['t1'] }, ['t1', 't2'])).toBe(true);
    expect(mutedFor({ muted_teams: ['t9'] }, ['t1'])).toBe(false);
    expect(mutedFor(undefined, ['t1'])).toBe(false);
  });
  it('only for the gated matches category', () => {
    expect(code('utils/notify.ts')).toMatch(/const teamIds = category === 'matches' \? await teamsOfNotification\(ctx\) : \[\];/);
  });
});

describe('notification_preferences shape', () => {
  it('booleans and a list of team ids', () => {
    expect(notificationPrefsProblem({ matches: false, chat: true, muted_teams: ['7254e4fb-3b5c-4e58-a1c1-341cf4c18df2'] })).toBeNull();
    expect(notificationPrefsProblem({ matches: 'no' })).toMatch(/on or off/);
    expect(notificationPrefsProblem({ muted_teams: ['x'] })).toMatch(/list of ids/);
    expect(notificationPrefsProblem({ muted_chats: ['7254e4fb-3b5c-4e58-a1c1-341cf4c18df2'] })).toBeNull();
    expect(notificationPrefsProblem([])).toMatch(/object/);
  });
});

describe('V014 · @username search', () => {
  it('a leading @ is stripped before matching handles', () => {
    expect(code('controllers/search.controller.ts')).toMatch(/replace\(\/\^@\+?\/, ''\)|replace\(\/\^@\//);
  });
});
