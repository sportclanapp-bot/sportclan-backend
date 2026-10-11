/**
 * Audit #78 (11 Oct 2026, Dipak): tournament leaderboards showed only the top
 * 5. Every board now holds everyone; the summary sends the first 5 and the
 * total, and GET /tournaments/:id/leaders/:stat pages through the rest.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { getTournamentTopPerformers, getTournamentLeaderBoard } from '../controllers/features.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };

test('twelve scorers: preview 5 of 12, then pages of 5 reach all 12', async () => {
  const players: Record<string, { goals: number }> = {};
  const users = [];
  for (let i = 1; i <= 12; i++) { players[`u${i}`] = { goals: 13 - i }; users.push({ id: `u${i}`, name: `Player ${i}` }); }
  db = fakeDb({
    sports: [{ id: 's', slug: 'football' }],
    tournaments: [{ id: 'T', sport_id: 's' }],
    teams: [{ id: 'X', name: 'X' }, { id: 'Y', name: 'Y' }],
    users,
    matches: [{ id: 'm', tournament_id: 'T', team_a_id: 'X', team_b_id: 'Y', winner_team_id: 'X', status: 'completed', result_type: null, voided_at: null, score_summary: { A: { score: 78 }, B: { score: 0 }, players } }],
  });
  const r = res();
  await getTournamentTopPerformers({ params: { id: 'T' } } as any, r);
  const goals = r.body.boards.find((b: any) => b.stat === 'goals');
  expect([goals.rows.length, goals.total]).toEqual([5, 12]);
  const seen: string[] = [];
  for (let offset = 0, more = true; more; offset += 5) {
    const p = res();
    await getTournamentLeaderBoard({ params: { id: 'T', stat: 'goals' }, query: { offset: String(offset), limit: '5' } } as any, p);
    seen.push(...p.body.board.rows.map((x: any) => x.user_id));
    more = p.body.has_more;
  }
  expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => `u${i + 1}`));
});
