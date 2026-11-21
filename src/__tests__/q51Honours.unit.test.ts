/**
 * Q51 (Dipak, 21 Nov 2026, A) · N-R7-60: the "Honours" line on a team's page and a player's profile —
 * champion (the tournament's champion_team_id) and runner-up (the loser of a knockout final won by the
 * champion), newest first. GET /teams/:id/honours and GET /users/:id/honours.
 */
jest.mock('../utils/supabase', () => ({ supabase: {} }));
import fs from 'fs';
import path from 'path';
import { runnerUpsFrom, sortHonours, type Honour, type TRow } from '../utils/honours';

const T = (id: string, format: string, champ: string, extra: Partial<TRow> = {}): TRow => ({ id, name: `Cup ${id}`, format, champion_team_id: champ, end_date: '2026-10-26', start_date: null, updated_at: null, ...extra });
const F = (tid: string, winner: string, loser: string, extra: object = {}) => ({ tournament_id: tid, winner_team_id: winner, loser, bracket: null, third_place: null, ...extra });

test('the loser of a knockout final won by the champion is runner-up', () => {
  const out = runnerUpsFrom([F('k', 'hawks', 'sharks')], [T('k', 'knockout', 'hawks')]);
  expect(out).toEqual([expect.objectContaining({ tournament_id: 'k', tournament_name: 'Cup k', place: 'runner_up', team_id: 'sharks', date: '2026-10-26' })]);
});

test('not a runner-up: the third-place match, a back draw, a final the champion did not win, a table format, a plain Swiss round', () => {
  const ts = [T('k', 'knockout', 'hawks'), T('l', 'league', 'hawks'), T('s', 'swiss', 'hawks'), T('sk', 'swiss', 'hawks', { settings: { swiss: { koDrawn: true } } })];
  expect(runnerUpsFrom([
    F('k', 'hawks', 'owls', { third_place: true }),
    F('k', 'hawks', 'owls', { bracket: 'back' }),
    F('k', 'owls', 'sharks'),
    F('l', 'hawks', 'sharks'),
    F('s', 'hawks', 'sharks'),
  ], ts)).toEqual([]);
  expect(runnerUpsFrom([F('sk', 'hawks', 'sharks', { bracket: 'ko' })], ts).map((h) => h.team_id)).toEqual(['sharks']);
});

test('an event of a multi-event tournament says its event', () => {
  expect(runnerUpsFrom([F('e', 'a', 'b')], [T('e', 'knockout', 'a', { name: 'City Open', event_label: "Men's singles" })])[0]!.tournament_name).toBe("City Open · Men's singles");
});

test('newest first; champion before runner-up on the same day', () => {
  const h = (id: string, place: Honour['place'], date: string): Honour => ({ tournament_id: id, tournament_name: id, place, team_id: 't', team_name: 'T', date });
  expect(sortHonours([h('old', 'champion', '2026-09-01'), h('b', 'runner_up', '2026-10-26'), h('a', 'champion', '2026-10-26')]).map((x) => x.tournament_id)).toEqual(['a', 'b', 'old']);
});

test('the routes', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  expect(read('routes/teams.routes.ts')).toContain("router.get('/:id/honours', authenticateToken, getTeamHonours);");
  expect(read('routes/users.routes.ts')).toContain("router.get('/:id/honours', authenticateToken, getUserHonours);");
  // a player's honours are hidden like the profile (deleted / blocked)
  expect(read('controllers/honours.controller.ts')).toMatch(/if \(await targetUserHidden\(id, viewer\)\) return res\.status\(404\)/);
});
