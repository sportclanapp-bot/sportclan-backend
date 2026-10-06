/**
 * Badminton gap 5 (Oct 2026) · order of play and call-ups: the court board
 * (playing / called / next / free, and what's ready), "Call" (both sides and
 * the umpire told), the next ready match to a free court (per player, across
 * events), and "running N minutes late".
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`;
const P = id(1); const MS = id(2); const MD = id(3);
const ORG = id(9); const UMP = id(8);
const at = (hhmm: string) => `2026-11-07T${hhmm}:00.000Z`;
const match = (n: number, ev: string, a: string, b: string, time: string, court: string | null, extra: object = {}) => ({
  id: id(100 + n), tournament_id: ev, team_a_id: a, team_b_id: b, team_a_name: `T-${a}`, team_b_name: `T-${b}`,
  scheduled_at: at(time), ground_label: court, status: 'scheduled', called_at: null, called_by: null, round: 1,
  umpire_id: null, scorer_id: null, voided_at: null, ...extra,
});
const mkDb = () => fakeDb({
  tournaments: [
    { id: P, name: 'Open', is_parent: true, parent_id: null, created_by: ORG, ground_count: 3, ground_names: ['Court 1', 'Court 2', 'Court 3'] },
    { id: MS, name: 'Open · MS', parent_id: P, event_label: 'MS', created_by: ORG, ground_count: 3, ground_names: ['Court 1', 'Court 2', 'Court 3'] },
    { id: MD, name: 'Open · MD', parent_id: P, event_label: 'MD', created_by: ORG, ground_count: 3, ground_names: ['Court 1', 'Court 2', 'Court 3'] },
  ],
  team_members: [
    { team_id: 'ravi', user_id: 'u-ravi' }, { team_id: 'amit', user_id: 'u-amit' }, { team_id: 'kiran', user_id: 'u-kiran' }, { team_id: 'dev', user_id: 'u-dev' },
    { team_id: 'ravi+amit', user_id: 'u-ravi' }, { team_id: 'ravi+amit', user_id: 'u-amit' }, { team_id: 'x+y', user_id: 'u-x' }, { team_id: 'x+y', user_id: 'u-y' },
  ],
  matches: [
    match(1, MS, 'ravi', 'amit', '04:00', 'Court 1', { status: 'live' }),
    match(2, MS, 'kiran', 'dev', '04:30', 'Court 2', { umpire_id: UMP }),
    match(3, MD, 'ravi+amit', 'x+y', '04:15', 'Court 3'),
    match(4, MS, 'tbd', 'tbd2', '05:00', 'Court 1', { team_a_id: null, team_b_id: null, team_a_name: 'TBD', team_b_name: 'TBD' }),
    match(5, MS, 'k', 'd', '03:00', 'Court 2', { status: 'completed' }),
  ],
});
let db = mkDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const sent: Array<{ ids: string[]; title: string; body: string; type: string }> = [];
jest.mock('../utils/notify', () => ({
  notifyUsers: jest.fn(async (ids: string[], n: { title: string; body: string; type: string }) => { sent.push({ ids, ...n }); }),
  matchAudienceIds: jest.fn(async (_m: string, a: string | null, b: string | null) => {
    const ids = [a, b].filter(Boolean) as string[];
    return db.t('team_members').filter((r) => ids.includes(r.team_id)).map((r) => r.user_id);
  }),
}));

// eslint-disable-next-line import/first
import { getCourtBoard, callToCourt, uncallMatch, nextToCourt, runningLate, courtsOf } from '../controllers/courtBoard.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params, body, query: {} } as any, r);
  return r;
};
const m = (n: number) => db.t('matches').find((x) => x.id === id(100 + n))!;
beforeEach(() => { db = mkDb(); sent.length = 0; });

test('the board: every event on the shared courts — playing, next, free; ready matches', async () => {
  const r = await run(getCourtBoard, 'anyone', { id: MS });
  expect(r.statusCode).toBe(200);
  const [c1, c2, c3] = r.body.courts;
  expect(c1).toMatchObject({ label: 'Court 1', playing: { id: id(101), event_label: 'MS' }, free: false });
  expect(c1.next.map((x: any) => x.id)).toEqual([id(104)]);
  expect(c2).toMatchObject({ playing: null, called: null, free: true });
  expect(c3.next[0]).toMatchObject({ id: id(103), event_label: 'MD', busy: true });
  // ready: sides known, not on court — MD's pair has Ravi, who's playing: flagged busy
  expect(r.body.ready.map((x: any) => [x.id, x.busy])).toEqual([[id(103), true], [id(102), false]]);
  expect(r.body.can_run).toBe(false);
  expect((await run(getCourtBoard, ORG, { id: P })).body.can_run).toBe(true);
});

test('Call: the court, both sides and the umpire are told; it shows as called', async () => {
  const r = await run(callToCourt, ORG, { id: id(102) });
  expect(r.statusCode).toBe(200);
  expect(m(2)).toMatchObject({ called_by: ORG, ground_label: 'Court 2' });
  expect(typeof m(2).called_at).toBe('string');
  expect(sent[0]).toMatchObject({ type: 'match_called', title: 'Court 2 now', body: 'T-kiran vs T-dev — please come to Court 2.' });
  expect(sent[0]!.ids.sort()).toEqual([UMP, 'u-dev', 'u-kiran'].sort());
  const board = await run(getCourtBoard, ORG, { id: MS });
  expect(board.body.courts[1]).toMatchObject({ called: { id: id(102) }, free: false });
  // to another court
  await run(uncallMatch, ORG, { id: id(102) });
  expect(m(2).called_at).toBeNull();
  await run(callToCourt, ORG, { id: id(102) }, { court: 'Court 3' });
  expect(m(2).ground_label).toBe('Court 3');
});

test('Call is the organiser’s, for a match not started with both sides known', async () => {
  expect((await run(callToCourt, 'u-ravi', { id: id(102) })).statusCode).toBe(403);
  expect((await run(callToCourt, ORG, { id: id(101) })).body.code).toBe('NOT_SCHEDULED');
  expect((await run(callToCourt, ORG, { id: id(104) })).body.code).toBe('SIDES_UNKNOWN');
  expect(sent).toHaveLength(0);
});

test('Next to a free court: the earliest ready match whose players are all free', async () => {
  // MD (04:15) has Ravi, who's on Court 1 → skipped; MS kiran v dev (04:30) goes
  const r = await run(nextToCourt, ORG, { id: P }, { court: 'Court 2' });
  expect(r.statusCode).toBe(200);
  expect(r.body.match.id).toBe(id(102));
  expect(m(2)).toMatchObject({ ground_label: 'Court 2' });
  expect((await run(nextToCourt, ORG, { id: P }, { court: 'Court 1' })).body.code).toBe('COURT_BUSY');
  // nothing else is ready (Ravi still playing)
  expect((await run(nextToCourt, ORG, { id: P }, { court: 'Court 3' })).body.code).toBe('NONE_READY');
  // Ravi's singles ends → the doubles can go
  m(1).status = 'completed';
  expect((await run(nextToCourt, ORG, { id: P }, { court: 'Court 3' })).body.match.id).toBe(id(103));
});

test('Running late: every match not started or called moves; everyone in them is told once', async () => {
  await run(callToCourt, ORG, { id: id(102) });
  sent.length = 0;
  const r = await run(runningLate, ORG, { id: MD }, { minutes: 30 });
  expect(r.body).toEqual({ moved: 2, minutes: 30 });
  expect(m(3).scheduled_at).toBe('2026-11-07T04:45:00.000Z');
  expect(m(4).scheduled_at).toBe('2026-11-07T05:30:00.000Z');
  expect(m(2).scheduled_at).toBe(at('04:30')); // called: stays
  expect(m(1).scheduled_at).toBe(at('04:00')); // live: stays
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ type: 'tournament_updated', title: 'Running 30 min late' });
  expect(sent[0]!.body).toMatch(/the next is at 10:15\.$/);
  expect((await run(runningLate, ORG, { id: P }, { minutes: 2 })).body.code).toBe('BAD_MINUTES');
  expect((await run(runningLate, 'u-ravi', { id: P }, { minutes: 30 })).statusCode).toBe(403);
});

test('courts: the named grounds, then any other label in use', () => {
  expect(courtsOf({ ground_count: 2, ground_names: null }, ['Court 9', null, 'Ground 1'])).toEqual(['Ground 1', 'Ground 2', 'Court 9']);
});
