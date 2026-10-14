/**
 * F158 (launch test plan, Round 2): every chess or carrom misconduct on the timeline said 'conduct',
 * not what the player did. N-SPP1-CHS-1: a chess game lost on a second illegal move, a phone, or the
 * arbiter's call read 'illegal move' / 'device' / 'conduct' — not the pad's words.
 */
import { sportCommentary } from '../utils/commentary';

const ctx = (sport: string) => ({ sport, teamA: 'Lions', teamB: 'Tigers', period: 1 } as never);
const v = (offence: string) => ({ kind: 'violation', team_side: 'A', offence, penalty: 'warning' });
it.each([
  ['carrom', 'seat', 'left the seat'], ['carrom', 'turn', 'played out of turn'], ['carrom', 'board', 'disturbed the board'],
  ['carrom', 'distraction', 'distracted the opponent'], ['carrom', 'refusal', 'refused the umpire'],
  ['chess', 'disturbing', 'disturbed the opponent'], ['chess', 'talking', 'talked or analysed in play'], ['chess', 'refusal', 'refused the arbiter'],
])('%s %s → %s', (sport, offence, words) => {
  expect(sportCommentary('note', v(offence), ctx(sport))).toContain(` · ${words} · `);
});
test('the others as before', () => {
  expect(sportCommentary('note', v('conduct'), ctx('tennis'))).toContain(' · unsportsmanlike conduct · ');
  expect(sportCommentary('note', v('other'), ctx('chess'))).toContain(' · conduct · ');
});
it.each([['illegal_move', 'two illegal moves'], ['device', 'a phone or device'], ['conduct', 'arbiter decision']])('chess result by %s reads "%s"', (reason, words) => {
  expect(sportCommentary('result', { winner: 'B', reason }, ctx('chess'))).toMatch(new RegExp(`— ${words}$`));
});
