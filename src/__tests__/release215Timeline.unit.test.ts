/**
 * 2.15.0 release pass (11 Oct 2026): clock and arbiter notes showed on the
 * timeline as raw `note {"kind":…}` text (basketball's clock, every timed
 * sport's kick-off / time's up, chess arbiter notes, badminton's serving order).
 */
import { sportCommentary } from '../utils/commentary';

const ctx = (sport: string, period = 0) => ({ sport, teamA: 'Kings', teamB: 'Hawks', period, move: 0, clockSeconds: null, regulation: null, periodMinutes: null });

describe('clock and arbiter notes have words', () => {
  it('basketball: tip-off, then a period’s clock, stop and restart', () => {
    expect(sportCommentary('note', { kind: 'kickoff' }, ctx('basketball'))).toBe('⏱ Tip-off');
    expect(sportCommentary('note', { kind: 'kickoff' }, ctx('basketball', 1))).toBe('⏱ Clock started');
    expect(sportCommentary('note', { kind: 'clock_pause' }, ctx('basketball'))).toBe('⏸ Clock stopped');
    expect(sportCommentary('note', { kind: 'clock_resume' }, ctx('basketball'))).toBe('▶ Clock restarted');
  });
  it('football keeps its kick-off; a clock correction says by how much', () => {
    expect(sportCommentary('note', { kind: 'kickoff' }, ctx('football'))).toBe('⏱ Kick-off');
    expect(sportCommentary('note', { kind: 'clock_adjust', seconds: -10 }, ctx('hockey'))).toBe('⏱ Clock corrected −10 s');
    expect(sportCommentary('note', { kind: 'clock_adjust', seconds: 60 }, ctx('football'))).toBe('⏱ Clock corrected +1 min');
  });
  it('timed rally sports: clock started, time’s up; badminton’s serving order', () => {
    expect(sportCommentary('note', { kind: 'kickoff' }, ctx('pickleball'))).toBe('⏱ Clock started');
    expect(sportCommentary('note', { kind: 'buzzer', typed: true }, ctx('table-tennis'))).toBe('⏰ Time’s up');
    expect(sportCommentary('note', { kind: 'serve_order', server: 2, receiver: 1 }, ctx('badminton'))).toBe('🏸 Serving order set — player 2 serves to player 1');
  });
  it('chess: clocks started, time added, an illegal move or wrong claim gives the opponent time', () => {
    expect(sportCommentary('note', { kind: 'kickoff' }, ctx('chess'))).toBe('⏱ Clocks started');
    expect(sportCommentary('note', { kind: 'add_time', side: 'B', seconds: 120 }, ctx('chess'))).toBe('⏱ Hawks: +2 min from the arbiter');
    expect(sportCommentary('note', { kind: 'illegal_move', side: 'B', board: 'B2', seconds: 60 }, ctx('chess'))).toBe('♟️ Illegal move — Hawks (board 2) · 1 min to Kings');
    expect(sportCommentary('note', { kind: 'wrong_claim', side: 'A', seconds: 60 }, ctx('chess'))).toBe('♟️ Wrong draw claim — Kings · 1 min to Hawks');
  });
});
