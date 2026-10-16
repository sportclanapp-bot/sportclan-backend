import { REGULATION_QUARTERS, periodLabel, isOvertime, canStartNextPeriod, canStartNextPeriodOf } from '../utils/basketballRules';
const CORE_REL = 'utils/basketballRules.ts';
const OTHER_CORE_REL = 'src/scoring/basketballRules.ts';
/**
 * The shared basketball period rule (decision A1), held to ONE fixture table in
 * both repos. basketballRules.ts is byte-identical in the app and the server;
 * this test body is identical too (only the import path differs).
 */
import fs from 'fs';
import path from 'path';
import { readOtherRepo, testWithOtherRepo } from './helpers/otherRepo';

describe('basketballRules', () => {
  test('Q1–Q4, then OT1, OT2 …', () => {
    expect([1, 2, 3, 4, 5, 6].map(periodLabel)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT1', 'OT2']);
    expect(isOvertime(4)).toBe(false);
    expect(isOvertime(5)).toBe(true);
    expect(REGULATION_QUARTERS).toBe(4);
  });
  test('the next period: always in regulation; after Q4 or an overtime only while level', () => {
    expect(canStartNextPeriod(1, 10, 2)).toBe(true);
    expect(canStartNextPeriod(3, 40, 20)).toBe(true);
    expect(canStartNextPeriod(4, 80, 80)).toBe(true);
    expect(canStartNextPeriod(4, 81, 80)).toBe(false);
    expect(canStartNextPeriod(5, 90, 90)).toBe(true);
    expect(canStartNextPeriod(5, 92, 90)).toBe(false);
    expect(canStartNextPeriod(4, 0, 0)).toBe(true); // N-TC-1: 4 quarters played level at 0-0 go to overtime
    expect(canStartNextPeriodOf(1, 0, 0, 1)).toBe(false); // BUILD 3.33: a fresh one-period game, nothing played
  });

  const here = path.join(__dirname, '..', CORE_REL);
  testWithOtherRepo('the app and server copies are identical', () => {
    expect(fs.readFileSync(here, 'utf8')).toBe(readOtherRepo(OTHER_CORE_REL));
  });
});

describe('A1 · overtime pushes', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { quarterPush } = require('../utils/scorePush') as typeof import('../utils/scorePush');
  test('End of Q4, then End of OT1', () => {
    const summary = { A: { points: 80 }, B: { points: 80 } };
    expect(quarterPush({ quarter: 4, summary, teamAName: 'A', teamBName: 'B' }).title).toBe('End of Q4');
    expect(quarterPush({ quarter: 5, summary, teamAName: 'A', teamBName: 'B' }).title).toBe('End of OT1');
  });
});
