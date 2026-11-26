/** Fix list 25 Nov 2026 · group 4 (speed, server): chats in bulk (8–10), timeline tail (15), small images (34). */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const mockUpload = jest.fn(async (key: string, _b: Buffer, _t: string) => `https://cdn.example/${key}`);
jest.mock('../utils/r2', () => ({ uploadBuffer: (k: string, b: Buffer, t: string) => mockUpload(k, b, t) }));
/* eslint-disable import/first */
import { chatRowVersion, parseKnownChats } from '../controllers/messages.controller';
import { timelineVersion } from '../controllers/matches.controller';
import { uploadProfilePhoto } from '../controllers/uploads.controller';
import { appVersionBody } from '../routes/app.routes';
import { keysNeedingSmall, smallKeyOf, SMALL_IMAGE_SIDE } from '../utils/smallImage';

const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('items 8–10 · chat list', () => {
  const m = src('controllers/messages.controller.ts');
  it('10: a version changes with anything the row shows, and not otherwise', () => {
    const row = { id: A, unreadCount: 1, lastMessage: { content: 'x' }, participants: [{ user: { name: 'N' } }] };
    const v = chatRowVersion(row);
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(chatRowVersion({ ...row, v: 'old' })).toBe(v);
    for (const d of [{ unreadCount: 0 }, { lastMessage: { content: 'y' } }, { participants: [{ user: { name: 'M' } }] }]) expect(chatRowVersion({ ...row, ...d })).not.toBe(v);
  });
  it('10: what the app says it holds; anything odd is ignored', () => {
    expect(parseKnownChats(`${A}.0123456789ab`)!.get(A)).toBe('0123456789ab');
    expect(parseKnownChats('zzz,,a.b')!.size).toBe(0);
    for (const x of [undefined, null, 5, ['a']]) expect(parseKnownChats(x)).toBeNull();
  });
  it('8: one call, with the old three-a-chat way when the function isn’t there', () => {
    expect(m).toContain("supabase.rpc('chat_list_extras'");
    expect(m).toContain('return enrichChatsOneByOne(chats, userId, blocked);');
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/171_chat_list_in_bulk.sql'), 'utf8');
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
    expect(sql.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(4);
  });
  it('9: after the reply, in one update, never twice for the same person', () => {
    expect(m).toContain("inBackground(markDeliveredForUser(chatIds, userId), 'mark delivered');");
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/171_chat_list_in_bulk.sql'), 'utf8');
    expect(sql).toContain('WHERE m.id = due.id AND NOT (m.delivered_to @> ARRAY[p_user])');
  });
});

describe('item 15 · timeline', () => {
  it('the version is of exactly what was sent', () => {
    expect(timelineVersion([{ a: 1 }], [{ b: 1 }])).toBe(timelineVersion([{ a: 1 }], [{ b: 1 }]));
    expect(timelineVersion([{ a: 1 }], [{ b: 1 }])).not.toBe(timelineVersion([{ a: 1 }], [{ b: 2 }]));
    expect(timelineVersion([{ a: 2 }], [{ b: 1 }])).not.toBe(timelineVersion([{ a: 1 }], [{ b: 1 }]));
  });
  it('a page of events leaves room for the row that says there is more (1000 is the database’s own limit)', () => {
    expect(src('controllers/scoring.controller.ts')).toContain('const size = n >= 1 ? Math.min(n, 999) : 500;');
  });
});

describe('item 34 · small images', () => {
  const res = () => { const r: any = { code: 200 }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
  const photo = async (w: number, h: number) => (await sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } }).jpeg().toBuffer()).toString('base64');
  const post = async (base64: string) => { const r = res(); await uploadProfilePhoto({ userId: 'u1', body: { base64, mime: 'image/jpeg' } } as never, r); return r; };
  beforeEach(() => mockUpload.mockClear());
  it('a full copy and a small one beside it, marked .v2', async () => {
    const r = await post(await photo(1600, 800));
    expect(r.body.url).toMatch(/profile-photos\/u1\/[0-9a-f-]{36}\.v2\.jpg$/);
    const calls = Object.fromEntries(mockUpload.mock.calls.map((c) => [c[0].endsWith('.s.jpg') ? 'small' : 'full', c]));
    expect(calls.small![0]).toBe(smallKeyOf(calls.full![0]));
    const [f, s] = await Promise.all([sharp(calls.full![1]).metadata(), sharp(calls.small![1]).metadata()]);
    expect([f.width, f.height]).toEqual([1200, 600]);
    expect([s.width, s.height]).toEqual([SMALL_IMAGE_SIDE, SMALL_IMAGE_SIDE / 2]);
  });
  it('a tiny photo is never made bigger', async () => {
    await post(await photo(40, 40));
    for (const c of mockUpload.mock.calls) expect((await sharp(c[1]).metadata()).width).toBe(40);
  });
  it('the small copy failing doesn’t fail the upload; the full one failing does', async () => {
    mockUpload.mockImplementation(async (k) => { if (k.endsWith('.s.jpg')) throw new Error('no'); return `https://cdn.example/${k}`; });
    expect((await post(await photo(500, 500))).code).toBe(200);
    mockUpload.mockImplementation(async (k) => { if (!k.endsWith('.s.jpg')) throw new Error('no'); return k; });
    expect((await post(await photo(500, 500))).code).toBe(500);
    mockUpload.mockImplementation(async (k) => `https://cdn.example/${k}`);
  });
  it('the backfill’s list: ours, without one yet; safe to run again', () => {
    expect(keysNeedingSmall(['profile-photos/u/a.jpg', 'profile-photos/u/b.jpg', 'profile-photos/u/b.s.jpg', 'profile-photos/u/c.v2.jpg', 'profile-photos/u/c.v2.s.jpg', 'voice-notes/x.m4a'])).toEqual(['profile-photos/u/a.jpg']);
    const s = fs.readFileSync(path.join(__dirname, '../../scripts/small-images-backfill.ts'), 'utf8');
    expect(s).not.toMatch(/DeleteObject|from\('|supabase/);
  });
  it('the app is told only when every older photo has one', () => {
    expect(appVersionBody({} as never)).not.toHaveProperty('smallImages');
    expect(appVersionBody({ SMALL_IMAGES_ALL: '1' } as never).smallImages).toBe(true);
  });
});
