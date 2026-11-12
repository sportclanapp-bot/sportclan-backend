/**
 * N-R7-S151 (Step 2 B13, SIDE-X1b-1): 'Decide the result → Replay the rest' on an abandoned
 * knockout match given as a walkover (football 3–0) kept the walkover's 3–0 on the scheduled
 * replay, while the bracket said 'not played yet'. The replay carries on from the score it
 * stopped at (0–0), the walkover marks gone; a result standing stands on that score too.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
jest.mock('../controllers/tournaments.controller', () => ({ ...jest.requireActual('../controllers/tournaments.controller'), advanceTournamentWinner: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { decideMatch } from '../controllers/matchDecision.controller';
// eslint-disable-next-line import/first
import { withWalkoverScore, withoutWalkover } from '../utils/walkoverScore';

const ID = '11111111-1111-4111-8111-111111111111';
const NEXT = '22222222-2222-4222-8222-222222222222';
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await decideMatch({ userId: 'org', params: { id: ID }, body } as any, r);
  return r;
};
const played = { A: { goals: 1, score: 1 }, B: { goals: 1, score: 1 }, periods: [{ A: 1, B: 1 }], players: {} };
const ko = (score_summary: Record<string, any>) => fakeDb({
  sports: [{ id: 's-fb', slug: 'football' }],
  tournaments: [{ id: 'T', format: 'knockout', settings: {} }],
  matches: [
    { id: ID, sport_id: 's-fb', tournament_id: 'T', created_by: 'org', status: 'abandoned', round: 1, group_label: null, next_match_id: NEXT, next_slot: 'A', winner_team_id: 'W', bracket: null, team_a_id: 'W', team_b_id: 'L', team_a_name: 'W', team_b_name: 'L', format: null, overs: null, rules: {}, score_summary, voided_at: null, scheduled_at: '2026-09-01T10:00:00Z' },
    { id: NEXT, status: 'scheduled', team_a_id: 'W', team_b_id: null, team_a_name: 'W', team_b_name: 'TBD' },
  ],
});
const row = () => db.t('matches').find((x) => x.id === ID)!;

describe('N-R7-S151: a replayed walkover carries on from the score it stopped at', () => {
  it('the walkover keeps the score it stopped at', () => {
    const ss = withWalkoverScore('football', {} as never, { ...played, walkover: true }, 'A');
    expect(ss.A.score).toBe(3);
    expect(ss.walkover_played).toEqual({ A: played.A, B: played.B });
    expect(withoutWalkover(ss)).toEqual(played);
  });

  it('Replay the rest: back to 1–1, no walkover', async () => {
    db = ko(withWalkoverScore('football', {} as never, { ...played, walkover: true }, 'A'));
    const r = await call({ decision: 'replay', reason: 'Floodlights fixed' });
    expect(r.statusCode).toBe(200);
    const ss = row().score_summary;
    expect(row().status).toBe('scheduled');
    expect(ss.A).toEqual({ goals: 1, score: 1 });
    expect(ss.B).toEqual({ goals: 1, score: 1 });
    expect(ss.walkover).toBeUndefined();
    expect(ss.walkover_score).toBeUndefined();
    expect(ss.decision.kind).toBe('replay');
  });

  it('an older walkover row (no kept score, as B13 X1b replay57): the goals count, 0–0', async () => {
    db = ko({ A: { goals: 0, score: 3 }, B: { goals: 0, score: 0 }, periods: [{ A: 0, B: 0 }], players: {}, walkover: true, walkover_score: { A: 3, B: 0 } });
    const r = await call({ decision: 'replay', reason: 'Floodlights fixed' });
    expect(r.statusCode).toBe(200);
    const ss = row().score_summary;
    expect([ss.A.score, ss.B.score]).toEqual([0, 0]);
    expect(ss.walkover).toBeUndefined();
  });

  it('Result stands: on the score it stopped at, not the walkover (a level knockout is refused)', async () => {
    db = ko(withWalkoverScore('football', {} as never, { ...played, walkover: true }, 'A'));
    const r = await call({ decision: 'stands', reason: 'No time left' });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('LEVEL_KNOCKOUT');
  });
});
