/**
 * N-R7-120 (Step 2 B7, SPP1-PKB-146): a match abandoned from the pad at 5-3 ended its
 * Timeline on the last point — no abandon line, and no way to give a reason. The abandon
 * now leaves a note (with the optional reason) that the timeline says in plain words.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { abandonMatch } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { timelineLine } from '../utils/commentary';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const M = '22222222-2222-4222-8222-222222222222';
const req = (body: Record<string, unknown>) => ({ userId: 'creator', params: { id: M }, body, header: () => undefined }) as any;
const seed = (status: string) => fakeDb({
  matches: [{ id: M, created_by: 'creator', umpire_id: null, scorer_id: null, status, tournament_id: null, team_a_id: null, team_b_id: null, team_a_name: 'Lions', team_b_name: 'Tigers', score_summary: {} }],
  match_scoring_leases: [],
  match_events: [],
});
const ctx = { sport: 'pickleball', teamA: 'Lions', teamB: 'Tigers', period: 0, move: 0, clockSeconds: null } as any;

test('a live match abandoned with a reason leaves an abandon note with it', async () => {
  db = seed('live');
  const r = res();
  await abandonMatch(req({ reason: '  Rain \n stopped play ' }), r);
  expect(r.statusCode).toBe(200);
  const notes = db.t('match_events').filter((e: any) => e.event_type === 'note');
  expect(notes.map((e: any) => e.payload)).toEqual([{ kind: 'abandoned', reason: 'Rain stopped play' }]);
});

test('the timeline says the abandon in words, with the reason', () => {
  expect(timelineLine('note', { kind: 'abandoned', reason: 'Rain stopped play' }, ctx).text).toBe('🚫 Match abandoned — Rain stopped play');
  expect(timelineLine('note', { kind: 'abandoned' }, ctx).text).toBe('🚫 Match abandoned');
  expect(timelineLine('note', { kind: 'abandoned', walkover_side: 'B' }, ctx).text).toBe('🚫 Match abandoned · Tigers go through (walkover)');
});

test('a reason over 200 characters is refused, and nothing is abandoned', async () => {
  db = seed('live');
  const r = res();
  await abandonMatch(req({ reason: 'x'.repeat(201) }), r);
  expect([r.statusCode, r.body.code]).toEqual([400, 'REASON_TOO_LONG']);
  expect(db.t('matches')[0]!.status).toBe('live');
});

test('a match nobody started gets no timeline line (it was not played)', async () => {
  db = seed('scheduled');
  const r = res();
  await abandonMatch(req({ reason: 'No court' }), r);
  expect(r.statusCode).toBe(200);
  expect(db.t('match_events')).toEqual([]);
});
