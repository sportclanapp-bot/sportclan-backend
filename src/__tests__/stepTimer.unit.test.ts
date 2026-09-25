/** Completion timing: steps, total and the Server-Timing header. */
import fs from 'fs';
import path from 'path';
import { stepTimer } from '../utils/stepTimer';

describe('stepTimer', () => {
  it('times each step from the previous mark', () => {
    let t = 1000;
    const timer = stepTimer(() => t);
    t = 1040; timer.mark('load');
    t = 1300; timer.mark('finalize');
    expect(timer.steps()).toEqual([{ name: 'load', ms: 40 }, { name: 'finalize', ms: 260 }]);
    expect(timer.total()).toBe(300);
    expect(timer.header()).toBe('load;dur=40, finalize;dur=260, total;dur=300');
  });

  it('completeMatch sends it back as Server-Timing', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    const start = src.indexOf('export async function completeMatch');
    const body = src.slice(start, src.indexOf('\nexport ', start + 10));
    expect(body).toContain("res.setHeader('Server-Timing', timer.header())");
    expect(body).toContain("timer.mark('finalize')");
  });
});
