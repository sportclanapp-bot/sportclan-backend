/**
 * Visual review B08 (backend) · V200 the timeline says who; V179 results use
 * an en dash, like every other score line.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../utils/supabase', () => ({ supabase: {} }));
// eslint-disable-next-line import/first
import { ballWho } from '../controllers/matches.controller';

describe('V200 · who bowled, who faced', () => {
  it('both names → "Bowler to Batter, what"', () => {
    expect(ballWho({ bowler_name: 'Khan', batsman_name: 'Sharma' }, 'SIX! That’s massive!')).toBe('Khan to Sharma, SIX! That’s massive!');
  });
  it('fewer names → what it knows', () => {
    expect(ballWho({ batsman_name: 'Sharma' }, 'Dot ball')).toBe('To Sharma, Dot ball');
    expect(ballWho({ bowler_name: 'Khan' }, 'Wide ball')).toBe('Khan, Wide ball');
    expect(ballWho({}, '1 run')).toBe('1 run');
  });
  it('balls and extras both go through it', () => {
    const s = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    expect((s.match(/commentary = ballWho\(p, commentary\);/g) ?? []).length).toBe(2);
  });
});

describe('V179 · en dash', () => {
  it('the generic result line', () => {
    const s = fs.readFileSync(path.join(__dirname, '../utils/matchResult.ts'), 'utf8');
    expect(s).toContain('won ${hi}–${lo}');
  });
});
