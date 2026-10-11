/**
 * Audit #56, #57, #72 (11 Oct 2026):
 *  #56 voiding a match decided "result stands" / "awarded" took away records
 *      that were never added; and since #6 a void must take back only what the
 *      result credited (players who agreed), not the whole line-up.
 *  #57 "replay" kept the old (past) time, so the hourly sweep abandoned it at
 *      once; a knockout winner already moved on stayed in the next round.
 *  #72 an "awarded" match wasn't marked a walkover.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
jest.mock('../controllers/tournaments.controller', () => ({ ...jest.requireActual('../controllers/tournaments.controller'), advanceTournamentWinner: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { recordDeltas } from '../utils/matchVoid';
// eslint-disable-next-line import/first
import { decideMatch } from '../controllers/matchDecision.controller';

const parts = (mid: string) => [{ match_id: mid, user_id: 'u1', team_side: 'A' }, { match_id: mid, user_id: 'u2', team_side: 'B' }, { match_id: mid, user_id: 'u3', team_side: 'B' }];
const call = async (body: object, id = '11111111-1111-4111-8111-111111111111') => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await decideMatch({ userId: 'org', params: { id }, body } as any, r);
  return r;
};

describe('#56: a void takes back only what the result gave', () => {
  it('nothing for a decided match', async () => {
    db = fakeDb({ matches: [{ id: 'd', sport_id: 's', status: 'completed', is_ranked: false, winner_team_id: null, team_a_id: null, team_b_id: null, score_summary: { winner_side: 'A', decision: { kind: 'stands' } } }], match_participants: parts('d'), rating_history: [] });
    expect(await recordDeltas('d')).toEqual([]);
  });
  it('only the players the result credited', async () => {
    db = fakeDb({ matches: [{ id: 'c', sport_id: 's', status: 'completed', is_ranked: false, winner_team_id: null, team_a_id: null, team_b_id: null, score_summary: { winner_side: 'A', attributed_user_ids: ['u1', 'u2'] } }], match_participants: parts('c'), rating_history: [] });
    expect((await recordDeltas('c')).map((d: any) => d.user_id).sort()).toEqual(['u1', 'u2']);
  });
});

describe('#57 / #72: replay and award', () => {
  const ko = () => fakeDb({
    sports: [{ id: 's-fb', slug: 'football' }],
    tournaments: [{ id: 'T', format: 'knockout', settings: {} }],
    matches: [
      { id: '11111111-1111-4111-8111-111111111111', sport_id: 's-fb', tournament_id: 'T', created_by: 'org', status: 'abandoned', round: 1, group_label: null, next_match_id: '22222222-2222-4222-8222-222222222222', next_slot: 'B', winner_team_id: 'W', bracket: null, team_a_id: 'L', team_b_id: 'W', team_a_name: 'L', team_b_name: 'W', format: null, overs: null, rules: {}, score_summary: { walkover: true }, voided_at: null, scheduled_at: '2026-09-01T10:00:00Z' },
      { id: '22222222-2222-4222-8222-222222222222', status: 'scheduled', team_a_id: 'X', team_b_id: 'W', team_a_name: 'X', team_b_name: 'W' },
    ],
  });
  it('#57 a replay is due now, and the winner comes back out of the next round', async () => {
    db = ko();
    const r = await call({ decision: 'replay', reason: 'pitch flooded' });
    expect(r.statusCode).toBe(200);
    const m = db.t('matches').find((x) => x.id === '11111111-1111-4111-8111-111111111111')!;
    expect(Date.parse(m.scheduled_at)).toBeGreaterThan(Date.now() - 60_000);
    const fin = db.t('matches').find((x) => x.id === '22222222-2222-4222-8222-222222222222')!;
    expect([fin.team_a_id, fin.team_b_id]).toEqual(['X', null]);
  });
  it('#72 an awarded match is marked a walkover', async () => {
    db = ko();
    db.t('sports')[0].slug = 'chess'; // a sport with no walkover score of its own
    db.t('matches')[0].status = 'live'; db.t('matches')[0].winner_team_id = null; db.t('matches')[0].score_summary = {};
    db.t('matches')[1].team_b_id = null;
    const r = await call({ decision: 'awarded', reason: 'no-show', winner_side: 'A' });
    expect(r.statusCode).toBe(200);
    expect(db.t('matches')[0].score_summary.walkover).toBe(true);
  });
});
