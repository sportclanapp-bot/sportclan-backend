/** Audit #15 (11 Oct 2026): an event edit was merged in with no checks at all. */
import { eventEditRefusal } from '../controllers/matchFeatures.controller';

const ball = { runs: 1, team_side: 'A', batsman_id: 'b1', bowler_id: 'w1' };
describe('audit #15: what an event edit may change', () => {
  it('the cricket runs edit the app makes still works (no top on runs)', () => {
    expect(eventEditRefusal(ball, { runs: 4 })).toBeNull();
    expect(eventEditRefusal(ball, { runs: 0 })).toBeNull();
  });
  it('refuses junk, a string, an array, an unknown key', () => {
    expect(eventEditRefusal(ball, 'oops')?.code).toBe('BAD_CHANGES');
    expect(eventEditRefusal(ball, [1, 2])?.code).toBe('BAD_CHANGES');
    expect(eventEditRefusal(ball, { foo: 1 })?.code).toBe('UNKNOWN_FIELD');
    expect(eventEditRefusal({ kind: 'goal', value: 1, team_side: 'A' }, { runs: 4 })?.code).toBe('UNKNOWN_FIELD');
  });
  it('refuses broken numbers and wrong types', () => {
    expect(eventEditRefusal(ball, { runs: -3 })?.code).toBe('BAD_FIELD_VALUE');
    expect(eventEditRefusal(ball, { runs: 1.5 })?.code).toBe('BAD_FIELD_VALUE');
    expect(eventEditRefusal(ball, { runs: Infinity })?.code).toBe('BAD_FIELD_VALUE');
    expect(eventEditRefusal(ball, { runs: '4' })?.code).toBe('BAD_FIELD_TYPE');
  });
  it('refuses moving the event to another side or player', () => {
    expect(eventEditRefusal(ball, { team_side: 'C' })?.code).toBe('FIELD_NOT_EDITABLE');
    expect(eventEditRefusal(ball, { bowler_id: 'guest:x' })?.code).toBe('FIELD_NOT_EDITABLE');
  });
});
