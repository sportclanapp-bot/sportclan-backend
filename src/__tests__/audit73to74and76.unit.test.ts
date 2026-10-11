/**
 * Audit #73, #74, #76 (11 Oct 2026):
 *  #73 a withdrawal gave a walkover in a voided fixture too.
 *  #74 a double elimination re-checked after a void stopped at the reset final
 *      that wasn't needed (cancelled), so it never crowned.
 *  #76 cancelling a tournament match left the competition stuck: a knockout
 *      had nobody going through, and a league whose last fixture it was never
 *      finished.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true) }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { walkoverOnWithdraw, recrownAfterVoidChange } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { cancelMatch } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };

test('#73 a voided fixture gets no walkover', async () => {
  db = fakeDb({
    sports: [{ id: 's', slug: 'badminton' }],
    tournaments: [{ id: 'T', format: 'league', settings: {} }],
    tournament_entries: [{ tournament_id: 'T', team_id: 'W', status: 'withdrawn' }, { tournament_id: 'T', team_id: 'O', status: 'approved' }],
    matches: [
      { id: 'v', tournament_id: 'T', team_a_id: 'W', team_b_id: 'O', status: 'scheduled', sport_id: 's', voided_at: '2026-10-01T00:00:00Z', score_summary: {} },
      { id: 'n', tournament_id: 'T', team_a_id: 'W', team_b_id: 'O', status: 'scheduled', sport_id: 's', voided_at: null, score_summary: {} },
    ],
  });
  await walkoverOnWithdraw('T', 'W');
  const [v, n] = db.t('matches');
  expect([v!.status, v!.winner_team_id ?? null]).toEqual(['scheduled', null]);
  expect([n!.status, n!.winner_team_id]).toEqual(['abandoned', 'O']);
});

test('#74 a double elimination crowns past the reset final that wasn’t needed', async () => {
  db = fakeDb({
    tournaments: [{ id: 'T', format: 'knockout', status: 'live', champion_team_id: null, name: 'DE' }],
    matches: [
      { id: 'f', tournament_id: 'T', bracket: 'final', round: 5, next_match_id: null, group_label: null, voided_at: null, status: 'completed', winner_team_id: 'A', team_a_id: 'A', team_b_id: 'B', team_a_name: 'A', team_b_name: 'B', third_place: false },
      { id: 'r', tournament_id: 'T', bracket: 'reset', round: 6, next_match_id: null, group_label: null, voided_at: null, status: 'cancelled', winner_team_id: null, team_a_id: 'A', team_b_id: 'B', third_place: false },
    ],
  });
  await recrownAfterVoidChange('f');
  expect([db.t('tournaments')[0]!.status, db.t('tournaments')[0]!.champion_team_id]).toEqual(['completed', 'A']);
});

describe('#76 cancelling a tournament match', () => {
  it('a knockout match: refused (award it or move it)', async () => {
    db = fakeDb({ tournaments: [{ id: 'T', format: 'knockout', status: 'live' }], matches: [{ id: '11111111-1111-4111-8111-111111111111', tournament_id: 'T', status: 'scheduled', round: 1, group_label: null, team_a_id: 'A', team_b_id: 'B' }] });
    const r = res();
    await cancelMatch({ userId: 'org', params: { id: '11111111-1111-4111-8111-111111111111' } } as any, r);
    expect([r.statusCode, r.body.code]).toEqual([409, 'KNOCKOUT_NO_CANCEL']);
    expect(db.t('matches')[0]!.status).toBe('scheduled');
  });
  it('a league’s last fixture: cancelled, and the league finishes', async () => {
    db = fakeDb({
      sports: [{ id: 's', slug: 'football' }],
      tournaments: [{ id: 'T', format: 'league', status: 'live', sport_id: 's', settings: {}, tiebreaker_rules: [], champion_team_id: null, name: 'L' }],
      tournament_entries: [{ tournament_id: 'T', team_id: 'A', status: 'approved', team: { name: 'A' } }, { tournament_id: 'T', team_id: 'B', status: 'approved', team: { name: 'B' } }],
      matches: [
        { id: 'p', tournament_id: 'T', status: 'completed', round: 1, group_label: null, team_a_id: 'A', team_b_id: 'B', winner_team_id: 'A', voided_at: null, score_summary: { A: { score: 2 }, B: { score: 0 } } },
        { id: '22222222-2222-4222-8222-222222222222', tournament_id: 'T', status: 'scheduled', round: 2, group_label: null, next_match_id: null, team_a_id: 'B', team_b_id: 'A', winner_team_id: null, voided_at: null, score_summary: {} },
      ],
    });
    const r = res();
    await cancelMatch({ userId: 'org', params: { id: '22222222-2222-4222-8222-222222222222' } } as any, r);
    expect(r.statusCode).toBe(200);
    expect([db.t('tournaments')[0]!.status, db.t('tournaments')[0]!.champion_team_id]).toEqual(['completed', 'A']);
  });
});
