/**
 * Fix list 25 Nov 2026 · item 2 (is_available in the sign-in answers) and item 3 ("Available to
 * play" off after 30 days away, back on at the next open only when the app switched it off).
 */
import fs from 'fs';
import path from 'path';
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
let mockNoColumn = false;
let mockThrow = false;
let mockUpdates: Array<Record<string, unknown>> = [];
jest.mock('../utils/supabase', () => ({
  get supabase() {
    return { ...db.client, from: (t: string) => {
      const b = db.client.from(t);
      const update = b.update;
      b.update = (set: Record<string, unknown>) => {
        mockUpdates.push(set);
        if (mockThrow) throw new Error('socket closed');
        if (mockNoColumn && 'is_available_auto_off' in set) {
          const c: any = new Proxy({}, { get: (_o, k) => (k === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, count: null, error: { code: 'PGRST204', message: "Could not find the 'is_available_auto_off' column" } })) : () => c) });
          return c;
        }
        return update(set);
      };
      return b;
    } };
  },
}));
// eslint-disable-next-line import/first
import { AUTO_OFF_AFTER_DAYS, isMissingColumn, restoreAvailabilityOnOpen, shouldCheckRestore, sweepAvailabilityAutoOff, withRestoredAvailability } from '../utils/availability';
// eslint-disable-next-line import/first
import { updateMe } from '../controllers/users.controller';

const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const row = (id: string) => db.t('users').find((u) => u.id === id)!;
beforeEach(() => {
  mockNoColumn = false; mockThrow = false; mockUpdates = [];
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  db = fakeDb({ users: [
    { id: 'auto', is_available: false, is_available_auto_off: true, deleted_at: null },
    { id: 'self', is_available: false, is_available_auto_off: false, deleted_at: null },
    { id: 'on', is_available: true, is_available_auto_off: false, deleted_at: null },
    { id: 'gone', is_available: false, is_available_auto_off: true, deleted_at: '2026-10-01' },
  ] });
});

describe('item 2 · every sign-in answer carries is_available', () => {
  it('the password, code and sign-up selects all ask for it', () => {
    const selects = [...src('controllers/auth.controller.ts').matchAll(/\.select\('([^']*account_type[^']*profile_picture_url[^']*)'\)/g)].map((m) => m[1]);
    expect(selects.length).toBe(3);
    for (const s of selects) expect(s).toMatch(/\bis_available\b/);
  });
  it('and the code / password answers give it as this open leaves it', () => {
    expect(src('controllers/auth.controller.ts').match(/withRestoredAvailability\(user\.id, (user|safe)\)/g)).toHaveLength(2);
  });
});

describe('item 3 · opening the app', () => {
  it('switched off by the app → back on, the mark cleared, presence fresh', async () => {
    expect(await withRestoredAvailability('auto', { is_available: false, name: 'A' })).toEqual({ is_available: true, name: 'A' });
    expect(row('auto')).toMatchObject({ is_available: true, is_available_auto_off: false });
    expect(Date.now() - Date.parse(row('auto').last_active_at)).toBeLessThan(5000);
  });
  it('switched off by the person → stays off', async () => {
    expect(await withRestoredAvailability('self', { is_available: false })).toEqual({ is_available: false });
    expect(row('self').is_available).toBe(false);
  });
  it('already on (or not in the row) → nothing is written', async () => {
    await withRestoredAvailability('on', { is_available: true });
    await withRestoredAvailability('on', {});
    expect(mockUpdates).toEqual([]);
  });
  it('a deleted account is never switched on; a second open changes nothing more', async () => {
    expect(await restoreAvailabilityOnOpen('gone')).toBe(false);
    expect(await restoreAvailabilityOnOpen('auto')).toBe(true);
    expect(await restoreAvailabilityOnOpen('auto')).toBe(false);
  });
  it('a failure never breaks the sign-in / profile answer', async () => {
    mockThrow = true;
    expect(await withRestoredAvailability('auto', { is_available: false })).toEqual({ is_available: false });
  });
  it('heartbeats look at most once an hour a person', () => {
    const T0 = Date.parse('2026-11-25T10:00:00Z');
    expect(shouldCheckRestore('h1', T0)).toBe(true);
    expect(shouldCheckRestore('h1', T0 + 59 * 60_000)).toBe(false);
    expect(shouldCheckRestore('h2', T0)).toBe(true);
    expect(shouldCheckRestore('h1', T0 + 61 * 60_000)).toBe(true);
  });
});

describe('item 3 · the sweep', () => {
  it('30 days, on rows only, marks them, idempotent', async () => {
    expect(AUTO_OFF_AFTER_DAYS).toBe(30);
    expect((await sweepAvailabilityAutoOff())).toEqual({ switchedOff: 0 }); // (the fake's update has no count)
    expect(mockUpdates).toEqual([{ is_available: false, is_available_auto_off: true }]);
    expect(row('self')).toMatchObject({ is_available: false, is_available_auto_off: false }); // the person's own choice keeps no mark
  });
  it('before migration 169: idle, warns once, throws nothing', async () => {
    mockNoColumn = true;
    expect(await sweepAvailabilityAutoOff()).toEqual({ switchedOff: 0 });
    expect(await restoreAvailabilityOnOpen('auto')).toBe(false);
    expect(row('on').is_available).toBe(true);
    expect([isMissingColumn({ code: 'PGRST204' }), isMissingColumn({ code: '42703' }), isMissingColumn({ code: '23505' }), isMissingColumn(null)]).toEqual([true, true, false, false]);
  });
  it('is a cron job and runs hourly in process', () => {
    expect(src('routes/jobs.routes.ts')).toMatch(/router\.use\(requireCronSecret\);[\s\S]*router\.post\('\/availability-auto-off'/);
    expect(src('index.ts')).toMatch(/setInterval\(runAvailability, 60 \* 60 \* 1000\)/);
  });
});

describe('item 3 · the person switches it themselves (PATCH /users/me)', () => {
  const patch = async (userId: string, body: Record<string, unknown>) => {
    const r: any = { statusCode: 200, body: null };
    r.status = (c: number) => { r.statusCode = c; return r; };
    r.json = (b: unknown) => { r.body = b; return r; };
    await updateMe({ userId, body, headers: {}, query: {}, params: {} } as any, r);
    return r;
  };
  it('off or on clears the mark in the same write', async () => {
    await patch('auto', { is_available: false });
    expect(row('auto')).toMatchObject({ is_available: false, is_available_auto_off: false });
    expect(await restoreAvailabilityOnOpen('auto')).toBe(false); // so the next open leaves it off
    await patch('self', { is_available: true });
    expect(row('self')).toMatchObject({ is_available: true, is_available_auto_off: false });
  });
  it('any other edit leaves the mark alone', async () => {
    await patch('auto', { bio: 'Hello' });
    expect(row('auto')).toMatchObject({ is_available_auto_off: true });
    expect(mockUpdates.some((u) => 'is_available_auto_off' in u)).toBe(false);
  });
  it('before migration 169 the switch still saves', async () => {
    mockNoColumn = true;
    const r = await patch('self', { is_available: true });
    expect(r.statusCode).toBe(200);
    expect(row('self').is_available).toBe(true);
  });
});
