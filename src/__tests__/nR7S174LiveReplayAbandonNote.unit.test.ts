/**
 * N-R7-S174 (Step 2 FINAL, SIDE-B18-1; seen in SIDE-C23x-2): 'Replay the rest' decided on a match still
 * LIVE (never abandoned) sent it back to scheduled with no abandon line in its log, so the reopened pad's
 * clock counted the whole time it stood (N-R7-706/708 stop it only at that line). It now writes the line,
 * with the decision's reason; a match already abandoned has its own line and gets no second one.
 */
import { fakeDb } from './helpers/fakeSupabase';

const ORG = 'org'; const M = 'ffffffff-ffff-4fff-8fff-000000000010';
const base = (extra: object = {}) => ({ id: M, sport_id: 'sp', tournament_id: null, created_by: ORG, status: 'live', round: null, group_label: null, next_match_id: null, team_a_id: 'TA', team_b_id: 'TB', team_a_name: 'Lions', team_b_name: 'Tigers', format: null, overs: null, rules: null, score_summary: { A: { score: 1 }, B: { score: 0 } }, voided_at: null, ...extra });
let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: 'football' })), normSportSlug: (s: string) => s }));
jest.mock('../utils/knockout', () => ({ isKnockoutBracketMatch: jest.fn(async () => false) }));
jest.mock('../controllers/tournaments.controller', () => ({ advanceTournamentWinner: jest.fn(async () => undefined), tournamentSettingsOf: jest.fn(async () => ({})) }));
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { decideMatch } from '../controllers/matchDecision.controller';

const run = async (body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await decideMatch({ userId: ORG, params: { id: M }, body, query: {} } as any, r);
  return r;
};
const notes = () => db.t('match_events').filter((e) => e.event_type === 'note' && e.payload?.kind === 'abandoned');

test('a live match sent to Replay the rest gets the abandon line with the reason', async () => {
  db = fakeDb({ matches: [base()] });
  expect((await run({ decision: 'replay', reason: 'Rain stopped play' })).statusCode).toBe(200);
  expect(db.t('matches')[0]!.status).toBe('scheduled');
  expect(notes().map((e) => [e.match_id, e.created_by, e.payload])).toEqual([[M, ORG, { kind: 'abandoned', reason: 'Rain stopped play' }]]);
});
test('an abandoned match (it has its line) gets no second one; a result that stands none', async () => {
  db = fakeDb({ matches: [base({ status: 'abandoned' })] });
  await run({ decision: 'replay', reason: 'Rain' });
  expect(notes()).toHaveLength(0);
  db = fakeDb({ matches: [base()] });
  await run({ decision: 'stands', reason: 'Rain' });
  expect(notes()).toHaveLength(0);
});
