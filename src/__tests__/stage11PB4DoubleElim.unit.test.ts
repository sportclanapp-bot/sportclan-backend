/**
 * Stage 11 · PB4 · double elimination: the back draw's shape (where each main
 * draw loser drops, where each back-draw winner goes), the setting's checks,
 * and the placings (the deciding final — the reset if played — and third the
 * back draw's final loser). The whole draw is played through against the local
 * server in scripts/formats/stage11-checks.mjs.
 */
import { backNext, backRoundName, backRounds, loserTarget } from '../utils/doubleElim';
import { settingsRefusal } from '../utils/tournamentSettings';
import { knockoutPlacings } from '../controllers/awards.controller';

describe('PB4 · the back draw', () => {
  it('2(k−1) rounds, halving every second round', () => {
    expect(backRounds(1)).toEqual([]);
    expect(backRounds(2)).toEqual([1, 1]);
    expect(backRounds(3)).toEqual([2, 2, 1, 1]);
    expect(backRounds(4)).toEqual([4, 4, 2, 2, 1, 1]);
    expect(backRounds(9).length).toBe(16); // a 512 draw: no top
  });
  it('main round 1 losers pair up; later losers drop in, in reverse', () => {
    expect([0, 1, 2, 3].map((m) => loserTarget(3, 1, m))).toEqual([
      { bracket: 'back', round: 1, matchNo: 0, slot: 'A' }, { bracket: 'back', round: 1, matchNo: 0, slot: 'B' },
      { bracket: 'back', round: 1, matchNo: 1, slot: 'A' }, { bracket: 'back', round: 1, matchNo: 1, slot: 'B' },
    ]);
    expect([0, 1].map((m) => loserTarget(3, 2, m))).toEqual([{ bracket: 'back', round: 2, matchNo: 1, slot: 'B' }, { bracket: 'back', round: 2, matchNo: 0, slot: 'B' }]);
    expect(loserTarget(3, 3, 0)).toEqual({ bracket: 'back', round: 4, matchNo: 0, slot: 'B' }); // the main final's loser: the back final
    expect(loserTarget(1, 1, 0)).toEqual({ bracket: 'final', round: 2, matchNo: 0, slot: 'B' }); // two entries
  });
  it('back winners: odd rounds keep their place, even rounds pair; the back final leads to the final (B)', () => {
    expect(backNext(3, 1, 1)).toEqual({ bracket: 'back', round: 2, matchNo: 1, slot: 'A' });
    expect(backNext(3, 2, 1)).toEqual({ bracket: 'back', round: 3, matchNo: 0, slot: 'B' });
    expect(backNext(3, 4, 0)).toEqual({ bracket: 'final', round: 4, matchNo: 0, slot: 'B' });
    expect(backRoundName(3, 4)).toBe('Back draw final'); expect(backRoundName(3, 2)).toBe('Back draw round 2');
  });
});

describe('PB4 · the setting', () => {
  it('a knockout or groups → knockout, alone', () => {
    expect(settingsRefusal('pickleball', 'knockout', { doubleElim: true })).toBeNull();
    expect(settingsRefusal('badminton', 'groups_knockout', { doubleElim: true })).toBeNull();
    expect(settingsRefusal('pickleball', 'league', { doubleElim: true })?.error).toMatch(/for a knockout/);
    expect(settingsRefusal('pickleball', 'knockout', { doubleElim: true, thirdPlace: true })?.error).toMatch(/no third-place match/);
  });
});

describe('PB4 · placings', () => {
  const row = (o: Record<string, unknown>) => ({ id: String(o.id), team_a_id: null, team_b_id: null, team_a_name: null, team_b_name: null, winner_team_id: null, status: 'scheduled', round: 1, group_label: null, voided_at: null, ...o }) as never;
  it('no reset: the final; third the back final’s loser', () => {
    const ms = [
      row({ id: 'f', bracket: 'final', round: 4, team_a_id: 'x', team_b_id: 'y', team_a_name: 'X', team_b_name: 'Y', winner_team_id: 'x', status: 'completed' }),
      row({ id: 'r', bracket: 'reset', round: 5, status: 'cancelled' }),
      row({ id: 'b', bracket: 'back', round: 4, team_a_id: 'y', team_b_id: 'z', team_a_name: 'Y', team_b_name: 'Z', winner_team_id: 'y', status: 'completed' }),
    ];
    expect(knockoutPlacings(ms).map((p) => [p.place, p.name])).toEqual([[1, 'X'], [2, 'Y'], [3, 'Z']]);
  });
  it('the reset decides it', () => {
    const ms = [
      row({ id: 'f', bracket: 'final', round: 4, team_a_id: 'x', team_b_id: 'y', team_a_name: 'X', team_b_name: 'Y', winner_team_id: 'y', status: 'completed' }),
      row({ id: 'r', bracket: 'reset', round: 5, team_a_id: 'x', team_b_id: 'y', team_a_name: 'X', team_b_name: 'Y', winner_team_id: 'y', status: 'completed' }),
    ];
    expect(knockoutPlacings(ms).map((p) => [p.place, p.name])).toEqual([[1, 'Y'], [2, 'X']]);
  });
});
