/**
 * Badminton 7.15 (Oct 2026) · a racket player's profile from the scores: games
 * and rally points won and lost, singles and doubles records apart — not the
 * tennis serve columns (never written for badminton, so always 0). Tennis is
 * unchanged.
 */
import { fakeDb } from './helpers/fakeSupabase';
import { racketStats } from '../utils/racketStats';

const id = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;
const ME = id(1); const BD = id(2); const TN = id(3);
const set = (a: number[], b: number[]) => ({ A: { score: 0, sets: a }, B: { score: 0, sets: b } });
const MS = [
  // singles, won 21–15 18–21 21–19 as A
  { id: id(10), team_a_id: 'ta', team_b_id: 'tb', winner_team_id: 'ta', score_summary: set([21, 18, 21], [15, 21, 19]) },
  // singles, lost 2 straight as B
  { id: id(11), team_a_id: 'tc', team_b_id: 'td', winner_team_id: 'tc', score_summary: set([21, 21], [10, 12]) },
  // doubles, won by walkover — no games or points
  { id: id(12), team_a_id: 'te', team_b_id: 'tf', winner_team_id: 'te', score_summary: set([], []) },
  // a team tie — neither record, nor games
  { id: id(13), team_a_id: 'tg', team_b_id: 'th', winner_team_id: 'tg', score_summary: { ...set([21, 21], [5, 5]), rubbers: [{ A: 2, B: 0, winner: 'A' }] } },
];
const side = new Map<string, 'A' | 'B'>([[id(10), 'A'], [id(11), 'B'], [id(12), 'A'], [id(13), 'A']]);
const size = new Map([[id(10), 1], [id(11), 1], [id(12), 2], [id(13), 3]]);

test('games, rally points, singles and doubles apart', () => {
  expect(racketStats(MS, side, size)).toEqual({
    games_won: 2, games_lost: 3, points_won: 60 + 22, points_lost: 55 + 42,
    singles_won: 1, singles_lost: 1, doubles_won: 1, doubles_lost: 0,
  });
});

let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async (sid: string) => ({ slug: sid === TN ? 'tennis' : 'badminton' })) }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), targetUserHidden: jest.fn(async () => false) }), { virtual: true });

test('the profile endpoint: badminton gets the score-based stats', async () => {
  db = fakeDb({
    user_sport_profiles: [{ user_id: ME, sport_id: BD, rating: 1200, matches_played: 2, wins: 1, losses: 1, draws: 0 }],
    users: [{ id: ME, name: 'Ravi', deleted_at: null }],
    matches: [{ ...MS[0], sport_id: BD, status: 'completed', voided_at: null }, { ...MS[1], sport_id: BD, status: 'completed', voided_at: null }],
    match_participants: [
      { match_id: id(10), user_id: ME, team_side: 'A', match: { id: id(10), voided_at: null, sport_id: BD, status: 'completed' } },
      { match_id: id(10), user_id: 'opp', team_side: 'B' },
      { match_id: id(11), user_id: ME, team_side: 'B', match: { id: id(11), voided_at: null, sport_id: BD, status: 'completed' } },
      { match_id: id(11), user_id: 'opp2', team_side: 'A' },
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSportProfile } = require('../controllers/users.controller');
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getSportProfile({ userId: ME, params: { id: ME, sportId: BD }, query: {}, headers: {} } as any, r);
  expect(r.body?.profile?.sportStats).toEqual({ games_won: 2, games_lost: 3, points_won: 82, points_lost: 97, singles_won: 1, singles_lost: 1, doubles_won: 0, doubles_lost: 0 });
});

// Stage 9 · T11: tennis's serve stats come from each match's serve stats (the
// participant columns were never written, so the profile read 0).
test('tennis: serve stats from the match, with sets and games', async () => {
  db = fakeDb({
    user_sport_profiles: [{ user_id: ME, sport_id: TN, rating: 1200, matches_played: 1, wins: 1, losses: 0, draws: 0 }],
    users: [{ id: ME, name: 'Ravi', deleted_at: null }],
    match_participants: [{ match_id: id(20), user_id: ME, team_side: 'A', match: { id: id(20), voided_at: null, sport_id: TN, status: 'completed' } }],
    matches: [{ id: id(20), team_a_id: 't1', team_b_id: 't2', winner_team_id: 't1', score_summary: { A: { sets: [6, 7] }, B: { sets: [3, 6] }, serve: { A: { aces: 4, double_faults: 1 }, B: { aces: 0, double_faults: 2 } } } }],
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSportProfile } = require('../controllers/users.controller');
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getSportProfile({ userId: ME, params: { id: ME, sportId: TN }, query: {}, headers: {} } as any, r);
  expect(r.body.profile.sportStats).toMatchObject({ total_aces: 4, total_double_faults: 1, sets_won: 2, sets_lost: 0, tennis_games_won: 13, tennis_games_lost: 9, singles_won: 1 });
});
