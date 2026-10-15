/**
 * F129 (launch test plan, Round 3) · the court board: a match could be called to a court with a called
 * match on it; 'running late' by an absurd number of minutes was a server error; 'Undo call' on a match
 * already being played said done and changed nothing.
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

test('a court with a match on it, or another called to it, is busy', async () => {
  const r = await run(callToCourt, ORG, { id: id(103) }, { court: 'Court 1' }); // Court 1: match 1 is live
  expect([r.statusCode, r.body.code]).toEqual([409, 'COURT_BUSY']);
  expect((await run(callToCourt, ORG, { id: id(102) })).statusCode).toBe(200); // Court 2, free
  const again = await run(callToCourt, ORG, { id: id(103) }, { court: 'Court 2' }); // now called there
  expect([again.statusCode, again.body.code]).toEqual([409, 'COURT_BUSY']);
  expect((await run(callToCourt, ORG, { id: id(102) })).statusCode).toBe(200); // calling it again to its own court
});
test('Undo call on a match being played says so, and changes nothing', async () => {
  m(1).called_at = '2026-11-07T03:58:00.000Z';
  const r = await run(uncallMatch, ORG, { id: id(101) });
  expect([r.statusCode, r.body.code]).toEqual([409, 'NOT_SCHEDULED']);
  expect(m(1).called_at).toBe('2026-11-07T03:58:00.000Z');
});
test('running late past what a calendar holds is a clear refusal, not a server error', async () => {
  const r = await run(runningLate, ORG, { id: P }, { minutes: 1e12 });
  expect([r.statusCode, r.body.code]).toEqual([400, 'BAD_MINUTES']);
  expect(m(2).scheduled_at).toBe(at('04:30'));
});
