/**
 * N-R7-S136 (Step 2 B12, SIDE-A5b-6): a co-ed event's women rule in the sport's
 * own words — football and hockey play on a pitch (as the app's womenOnLabel,
 * N-R7-S60). Hockey refused a line-up with '… needs at least 2 on court.'
 */
import { categoryLabel, categoryRefusal, womenOnCourtProblem, womenOnWhere } from '../utils/tournamentSettings';

const c = { gender: 'mixed' as const, minWomen: 2 };
const one = [{ gender: 'female' }, { gender: 'male' }, { gender: 'male' }];

describe('N-R7-S136 · women on the pitch', () => {
  it('the line-up refusal says where, by sport', () => {
    expect(womenOnCourtProblem(c, one, 'Lions', 'hockey')).toBe('Lions have 1 woman starting — this event needs at least 2 on the pitch.');
    expect(womenOnCourtProblem(c, one, 'Lions', 'football')).toBe('Lions have 1 woman starting — this event needs at least 2 on the pitch.');
    expect(womenOnCourtProblem(c, one, 'Kings', 'volleyball')).toBe('Kings have 1 woman starting — this event needs at least 2 on court.');
    expect(womenOnCourtProblem(c, one, 'Kings')).toBe('Kings have 1 woman starting — this event needs at least 2 on court.');
  });
  it('the category line and the setting refusals too', () => {
    expect(categoryLabel(c, 'hockey')).toBe('Mixed · At least 2 women on the pitch');
    expect(categoryLabel(c, 'basketball')).toBe('Mixed · At least 2 women on court');
    expect(categoryRefusal({ minWomen: 0 }, 'hockey')?.error).toBe('Women on the pitch is a whole number, 1 or more.');
    expect(categoryRefusal({ gender: 'men', minWomen: 2 }, 'football')?.error).toBe('Women on the pitch is for an open or mixed event.');
    expect(categoryRefusal({ minWomen: 0 }, 'volleyball')?.error).toBe('Women on court is a whole number, 1 or more.');
    expect(womenOnWhere('Hockey')).toBe('on the pitch');
    expect(womenOnWhere(null)).toBe('on court');
  });
});
