/**
 * Soft chat membership (decided 27 Sep 2026 — no hard deletes of user data;
 * migration 098).
 *
 * Leaving a chat, being removed, a tournament-chat sync removal and "Delete
 * group" all used to DELETE rows. Now they set chat_participants.left_at or
 * chats.deleted_at, and every read ignores those rows — so someone who left
 * gets no messages, no unread count, no typing and no member-list entry, and a
 * deleted group is in no list and takes no messages.
 */
import fs from 'fs';
import path from 'path';

const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const FILES = [
  'controllers/messages.controller.ts',
  'controllers/matches.controller.ts',
  'controllers/tournaments.controller.ts',
  'utils/tournamentChat.ts',
];

// ── behaviour of the helpers, against a fake supabase ─────────────────────
type Row = Record<string, any>;
const db: { chat_participants: Row[]; chats: Row[] } = { chat_participants: [], chats: [] };
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let upsertRows: Row[] | null = null;
    const q: any = {
      select: () => q,
      update: (p: Row) => { patch = p; return q; },
      upsert: (rows: Row[]) => { upsertRows = rows; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      is: (c: string, v: null) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      then: (resolve: (v: unknown) => unknown) => {
        const t = (db as any)[table] as Row[];
        if (upsertRows) {
          for (const r of upsertRows) if (!t.some((x) => x.chat_id === r.chat_id && x.user_id === r.user_id)) t.push({ ...r });
          return resolve({ data: null, error: null });
        }
        const rows = t.filter((r) => filters.every((f) => f(r)));
        if (patch) for (const r of rows) Object.assign(r, patch);
        return resolve({ data: rows, error: null });
      },
    };
    return q;
  };
  return { supabase: { from } };
});
// eslint-disable-next-line import/first
import { joinChat, leaveChat, softDeleteChat } from '../utils/chatMembership';

beforeEach(() => {
  db.chat_participants = [{ chat_id: 'c', user_id: 'admin', role: 'admin' }];
  db.chats = [{ id: 'c' }];
});

describe('leave, rejoin, delete — nothing is removed', () => {
  it('leaving marks the row; it is not deleted', async () => {
    db.chat_participants.push({ chat_id: 'c', user_id: 'u', role: 'member' });
    await leaveChat('c', ['u']);
    const row = db.chat_participants.find((r) => r.user_id === 'u')!;
    expect(db.chat_participants).toHaveLength(2);
    expect(row.left_at).toBeTruthy();
  });
  it('rejoining clears left_at on the same row — no second row', async () => {
    db.chat_participants.push({ chat_id: 'c', user_id: 'u', role: 'member', left_at: '2026-09-01T00:00:00Z' });
    await joinChat('c', [{ user_id: 'u', role: 'member' }]);
    const rows = db.chat_participants.filter((r) => r.user_id === 'u');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.left_at).toBeNull();
  });
  it('a current member is left alone (an admin is not demoted by a re-add)', async () => {
    await joinChat('c', [{ user_id: 'admin', role: 'member' }]);
    expect(db.chat_participants.find((r) => r.user_id === 'admin')!.role).toBe('admin');
  });
  it('a newcomer gets a new row', async () => {
    await joinChat('c', [{ user_id: 'new', role: 'member' }]);
    expect(db.chat_participants.some((r) => r.user_id === 'new' && !r.left_at)).toBe(true);
  });
  it('deleting a group sets deleted_at; the chat stays', async () => {
    await softDeleteChat('c');
    expect(db.chats).toHaveLength(1);
    expect(db.chats[0]!.deleted_at).toBeTruthy();
  });
});

// ── the sweep: every read filters, no write deletes ───────────────────────
describe('every chat_participants READ ignores people who left', () => {
  it.each(FILES)('%s', (f) => {
    const s = code(f);
    const reads = [...s.matchAll(/\.from\('chat_participants'\)\s*\.select\(/g)];
    for (const m of reads) {
      const window = s.slice(m.index!, m.index! + 400);
      expect(window).toMatch(/\.is\('left_at', null\)/);
    }
  });
  it('the only unfiltered read is joinChat’s own lookup, which must see left rows to rejoin them', () => {
    const s = code('utils/chatMembership.ts');
    expect(s).toMatch(/select\('user_id, left_at'\)/);
  });
});

describe('no hard delete of chat membership or chats remains', () => {
  it.each([...FILES, 'utils/chatMembership.ts'])('%s', (f) => {
    const s = code(f);
    expect(s).not.toMatch(/from\('chat_participants'\)[^;]{0,80}\.delete\(\)/);
    expect(s).not.toMatch(/from\('chats'\)[^;]{0,80}\.delete\(\)/);
  });
});

describe('deleted groups are in no list and take no messages', () => {
  const m = code('controllers/messages.controller.ts');
  it('the chat list skips them', () => expect(m).toMatch(/\.in\('id', chatIds\)\s*\.is\('deleted_at', null\)/));
  it('the unread badge skips them', () => expect(m).toMatch(/chat:chats!inner\(deleted_at\)'\)\.is\('left_at', null\)\s*\.is\('chat\.deleted_at', null\)/));
  it('read, send, mark-read, typing and forward all gate on an active member of a live chat', () => {
    for (const fn of ['getMessages', 'sendMessage', 'markAsRead', 'setTyping']) {
      const i = m.indexOf(`export async function ${fn}(`);
      expect(m.slice(i, i + 3000)).toMatch(/const participant = await isActiveMember\(id, userId\);/);
    }
    expect(m).toMatch(/async function isChatParticipant[\s\S]{0,200}return isActiveMember\(chatId, userId\);/);
    expect(code('utils/chatMembership.ts')).toMatch(/\.is\('left_at', null\)\s*\.is\('chat\.deleted_at', null\)/);
  });
  it('"Delete group" sets deleted_at', () => {
    const i = m.indexOf('export async function deleteGroup(');
    expect(m.slice(i, i + 1200)).toMatch(/update\(\{ deleted_at: new Date\(\)\.toISOString\(\) \}\)/);
  });
});
