/**
 * F007 (launch test plan): match reminders came 10 to 15 minutes before the start
 * (a 5-minute sweep over "the next 15 minutes"), and a match whose reminder time
 * fell while the free server was asleep never got one. The sweep now runs every
 * minute, and on waking it still reminds a match that hasn't started and was due
 * at most REMINDER_CATCHUP_MS ago — once, however often it runs.
 */
import fs from 'fs';
import path from 'path';
import { fakeDb } from './helpers/fakeSupabase';

const mockDb = { client: null as any };
jest.mock('../utils/supabase', () => ({ get supabase() { return mockDb.client; } }));
const mockNotify = jest.fn(async (_n: { userId: string; body: string }) => undefined);
jest.mock('../utils/notify', () => ({
  ...jest.requireActual('../utils/notify'),
  notifyUser: (n: { userId: string; body: string }) => mockNotify(n),
  matchAudienceIds: async () => ['u1', 'u2'],
}));
jest.mock('../utils/matchNames', () => ({ matchNamesForNotice: async () => 'Lions vs Tigers' }));
// eslint-disable-next-line import/first
import { runMatchReminderSweep, REMINDER_TICK_MS, REMINDER_CATCHUP_MS } from '../controllers/features.controller';

const START = Date.parse('2026-10-16T15:30:00Z'); // 9:00 pm IST
const MIN = 60_000;
let db: ReturnType<typeof fakeDb>;
const claims = new Set<string>();
beforeEach(() => {
  mockNotify.mockClear();
  claims.clear();
  db = fakeDb({ matches: [{ id: 'm1', team_a_id: null, team_b_id: null, team_a_name: 'Lions', team_b_name: 'Tigers', scheduled_at: new Date(START).toISOString(), umpire_id: null, status: 'scheduled', voided_at: null }] });
  // notification_sends has UNIQUE(user_id, job_type, sent_on): a second claim fails.
  mockDb.client = {
    from: (t: string) => (t === 'notification_sends'
      ? { insert: async (r: { user_id: string; job_type: string; sent_on: string }) => {
        const k = `${r.user_id}|${r.job_type}|${r.sent_on}`;
        if (claims.has(k)) return { error: { code: '23505', message: 'duplicate' } };
        claims.add(k); return { error: null };
      } }
      : db.client.from(t)),
  };
});
afterEach(() => jest.useRealTimers());
const at = async (ms: number) => { jest.useFakeTimers({ now: ms, doNotFake: ['setImmediate', 'nextTick'] }); return runMatchReminderSweep(); };

test('on the in-process timer the reminder goes 14–15 minutes before, not 10–15', async () => {
  expect(REMINDER_TICK_MS).toBeLessThanOrEqual(MIN);
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
  expect(idx).toContain('setInterval(runReminders, REMINDER_TICK_MS)');
  // Ticks from a start-time-unaligned moment (the server booted at :07.4).
  let firstAt: number | null = null;
  for (let t = START - 30 * MIN + 7_400; t < START && firstAt == null; t += REMINDER_TICK_MS) {
    if ((await at(t)).sent > 0) firstAt = t;
  }
  expect(firstAt).not.toBeNull();
  expect(START - firstAt!).toBeGreaterThan(14 * MIN);
  expect(START - firstAt!).toBeLessThanOrEqual(15 * MIN);
  expect(mockNotify.mock.calls.map((c) => c[0].userId).sort()).toEqual(['u1', 'u2']);
  expect(mockNotify.mock.calls[0]![0].body).toMatch(/^⏰ Lions vs Tigers starts at .+ in 15 minutes!$/);
});

test('asleep through the reminder time: on waking it still reminds, once, saying it was due', async () => {
  expect((await at(START + 5 * MIN)).sent).toBe(2);
  expect(mockNotify.mock.calls[0]![0].body).toMatch(/^⏰ Lions vs Tigers was due to start at .+ and hasn’t started yet\.$/);
  expect((await at(START + 6 * MIN)).sent).toBe(0); // the next tick, or a scheduler call: no repeat
});

test('woken a little before: the minutes left are said as they are', async () => {
  await at(START - 4 * MIN);
  expect(mockNotify.mock.calls[0]![0].body).toMatch(/in 4 minutes!$/);
});

test('no catch-up for a match long past, or one that started', async () => {
  expect((await at(START + REMINDER_CATCHUP_MS + MIN)).sent).toBe(0);
  db.t('matches')[0]!.status = 'live';
  expect((await at(START + 2 * MIN)).sent).toBe(0);
});

test('the app-open reminder takes the same claim and says the real minutes, so the two never both remind', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'users.controller.ts'), 'utf8');
  const body = src.slice(src.indexOf('async function runSmartNotifications('), src.indexOf('// 2. Friday evening'));
  expect(body).toContain(".insert({ user_id: userId, job_type: `match_reminder:${m.id}`, sent_on: String(m.scheduled_at).slice(0, 10) });");
  expect(body).toContain('matchReminderBody(');
  expect(body).not.toContain('starts in 15 minutes!`');
});
