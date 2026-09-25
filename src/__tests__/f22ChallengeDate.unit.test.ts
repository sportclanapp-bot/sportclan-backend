/** F-22: the singles challenge never said when the match is. */
import fs from 'fs';
import path from 'path';
import { istWhen } from '../utils/appTime';
import { challengeText } from '../utils/singles';

describe('istWhen', () => {
  test('India time, short and readable', () => {
    expect(istWhen('2026-09-27T13:00:00Z')).toBe('Sun 27 Sep · 6:30 pm');
    expect(istWhen('2026-09-27T18:45:00Z')).toBe('Mon 28 Sep · 12:15 am'); // crosses midnight in IST
    expect(istWhen('2026-01-01T06:30:00Z')).toBe('Thu 1 Jan · 12:00 pm');
  });
  test('missing or bad → null', () => {
    expect(istWhen(null)).toBeNull();
    expect(istWhen('soon')).toBeNull();
  });
});

describe('the challenge carries the date', () => {
  test('challengeText puts it after the match kind', () => {
    expect(challengeText({ challengerName: 'Asha', sportName: 'Badminton', ranked: true, when: 'Sun 27 Sep · 6:30 pm' }).body)
      .toBe('A ranked badminton singles match · Sun 27 Sep · 6:30 pm. Open it to accept or decline.');
  });
  test('createMatch passes the scheduled time, not null', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    expect(src).toContain('when: istWhen(data.scheduled_at as string | null)');
    expect(src).not.toMatch(/ranked: !!is_ranked,\s*when: null/);
  });
});
