/**
 * N-R7-475 (SIDE-XS1-1, Step 2 Batch 14 XS1 on emulator-5558): a named scorer who tapped Void on a casual
 * match was told 'Only an organiser, the umpire or an admin can void a match.' — but on a casual match it is the
 * match's creator who can void it (canOfficiateMatch), so the scorer was never told whom to ask. The refusal now
 * names who really can: the creator on a casual match, the organiser on a tournament match.
 */
import fs from 'fs';
import path from 'path';
import { voidRefusal } from '../utils/voidWords';

describe('N-R7-475 · the void / restore refusal names who can do it', () => {
  it('casual match → the creator; tournament match → the organiser', () => {
    expect(voidRefusal({ tournament_id: null }, 'void')).toBe('Only the match’s creator, the umpire or an admin can void a match.');
    expect(voidRefusal({ tournament_id: 't1' }, 'void')).toBe('Only an organiser, the umpire or an admin can void a match.');
    expect(voidRefusal({}, 'restore')).toBe('Only the match’s creator, the umpire or an admin can restore a match.');
    expect(voidRefusal({ tournament_id: 't1' }, 'restore')).toBe('Only an organiser, the umpire or an admin can restore a match.');
  });
  it('the void and the restore both use it', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
    expect(src).not.toContain("'Only an organiser, the umpire or an admin can void a match.'");
    expect(src).toContain("voidRefusal(match, 'void')");
    expect(src).toContain("voidRefusal(match, 'restore')");
  });
});
