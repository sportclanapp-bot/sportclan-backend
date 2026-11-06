/**
 * N-R7-130 (Step 2, Batch 8 · SCR-T-192): chess Swiss of 8, 3 rounds, top 4 to a knockout. The
 * knockout is drawn as soon as round 3 ends (1 v 4, 2 v 3). The 2nd-placed player then withdrew:
 * the semi went to the 3rd as a walkover and the 5th never moved in. While no knockout game has
 * been played, the knockout is drawn again without them: 1st v 5th, 3rd v 4th. Once a knockout game
 * is under way, the walkover stands.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), notifyUnlessBlocked: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { walkoverOnWithdraw } from '../controllers/tournaments.controller';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P = (i: number) => `00000000-0000-4000-8000-${String(900 + i).padStart(12, '0')}`;
// Final table after 3 rounds: P1 3, P2 2.5, P3 2, P4 1.5, P5 1.5 (lost to P4), P6 1, P7 0.5, P8 0.
const g = (id: string, round: number, a: number, b: number, w: number | null) => ({
  id, tournament_id: T, round, match_no: Number(id.slice(1)), bracket: null, voided_at: null, status: 'completed', scheduled_at: '2026-11-01T10:00:00Z', overs: null,
  team_a_id: P(a), team_b_id: P(b), winner_team_id: w == null ? null : P(w),
  score_summary: w == null ? { A: { score: 0.5 }, B: { score: 0.5 }, result_type: 'draw' } : { A: { score: w === a ? 1 : 0 }, B: { score: w === b ? 1 : 0 } },
});
const swiss = [
  g('s1', 1, 1, 5, 1), g('s2', 1, 2, 6, 2), g('s3', 1, 3, 7, 3), g('s4', 1, 4, 8, 4),
  g('s5', 2, 1, 2, 1), g('s6', 2, 3, 4, null), g('s7', 2, 5, 7, 5), g('s8', 2, 6, 8, 6),
  g('s9', 3, 1, 3, 1), g('s10', 3, 2, 4, 2), g('s11', 3, 5, 6, null), g('s12', 3, 7, 8, null),
];
const koRow = (id: string, round: number, no: number, a: number | null, b: number | null, next: string | null, slot: 'A' | 'B' | null, status = 'scheduled') => ({
  id, tournament_id: T, round, match_no: no, bracket: 'ko', voided_at: null, status, scheduled_at: '2026-11-01T14:00:00Z', score_summary: {},
  team_a_id: a == null ? null : P(a), team_b_id: b == null ? null : P(b), team_a_name: a == null ? 'TBD' : `P0${a}`, team_b_name: b == null ? 'TBD' : `P0${b}`,
  winner_team_id: null, next_match_id: next, next_slot: slot,
});
function seed(semiStatus = 'scheduled') {
  db = fakeDb({
    sports: [{ id: S, slug: 'chess', allows_draw: true }],
    tournaments: [{ id: T, name: 'Swiss 8', format: 'swiss', sport_id: S, created_by: 'org', status: 'ongoing', fixtures_generated: true,
      settings: { swiss: { rounds: 3, paired: 3, knockout: 4, koDrawn: true, tpn: [1, 2, 3, 4, 5, 6, 7, 8].map(P) } }, tiebreaker_rules: [], match_rules: null, entry_kind: 'singles' }],
    tournament_entries: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ tournament_id: T, team_id: P(i), status: i === 2 ? 'withdrawn' : 'approved', seed: i, entered_at: null, club: null, team: { id: P(i), name: `P0${i}` } })),
    matches: [...swiss, koRow('kf', 2, 0, null, null, null, null), koRow('k1', 1, 0, 1, 4, 'kf', 'A', semiStatus), koRow('k2', 1, 1, 2, 3, 'kf', 'B')],
    match_events: [],
  });
}
const koNow = () => db.t('matches').filter((m) => m.bracket === 'ko' && !m.voided_at);
const pair = (m: Record<string, any>) => [m.team_a_id, m.team_b_id].sort().join(' v ');

test('SCR-T-192: the 2nd withdraws before the knockout starts → it is drawn again, the 5th moves in', async () => {
  seed();
  await walkoverOnWithdraw(T, P(2));
  const firsts = koNow().filter((m) => m.round === 1);
  expect(firsts.map(pair).sort()).toEqual([[P(1), P(5)].sort().join(' v '), [P(3), P(4)].sort().join(' v ')].sort());
  expect(koNow().some((m) => m.status === 'abandoned')).toBe(false); // no walkover
  expect(db.t('deleted_records').filter((r) => r.table_name === 'matches').map((r) => r.row_id).sort()).toEqual(['k1', 'k2', 'kf']);
});

test('a knockout game already under way: the walkover rule stands', async () => {
  seed('live');
  await walkoverOnWithdraw(T, P(2));
  const k2 = db.t('matches').find((m) => m.id === 'k2')!;
  expect(k2.status).toBe('abandoned');
  expect(k2.winner_team_id).toBe(P(3));
  expect(db.t('deleted_records').length).toBe(0);
});
