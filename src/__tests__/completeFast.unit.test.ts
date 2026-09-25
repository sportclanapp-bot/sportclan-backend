/**
 * Completion took ~10 s (~25 sequential ~300 ms round-trips from Render). What
 * must stay true for it to stay fast, and correct.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
const start = src.indexOf('export async function completeMatch');
const body = src.slice(start, src.indexOf('\nexport ', start + 10));
const respondAt = body.indexOf('res.json({\n      match: updatedMatch');
const before = body.slice(0, respondAt);
const afterFn = body.slice(body.indexOf('const afterResponse = async'), respondAt);

describe('completeMatch', () => {
  test('builds the summary once, not twice', () => {
    expect(body.match(/recomputeSummary\(id/g)).toHaveLength(1);
  });

  test('reads lease, participants, sport and summary together', () => {
    // started before the match row is even loaded, awaited together after it
    expect(before.indexOf('const leaseP = checkLease(id, userId, deviceIdOf(req))')).toBeLessThan(before.indexOf(".from('matches')"));
    expect(before).toContain("recomputeSummary(id, { persist: false })");
    expect(before).toMatch(/Promise\.all\(\[\s*leaseP,\s*partsP,/);
    expect(before).toContain('getSport(match.sport_id as string)');
  });

  test('the result the screen shows is written BEFORE the response', () => {
    const patchAt = before.indexOf("await supabase.from('matches').update(patch).eq('id', id);");
    expect(patchAt).toBeGreaterThan(0);
    expect(patchAt).toBeLessThan(before.indexOf('const afterResponse = async'));
    expect(before.indexOf('await advanceTournamentWinner(id)')).toBeLessThan(before.indexOf('const afterResponse = async'));
  });

  test('side effects run after it', () => {
    for (const step of ['awardCoins(', 'streak_count', 'writeCricketInningsStats(id)', 'calculateAndSetMVP(id)', "type: 'match_result'", 'awardBadgesSafe(']) {
      expect(afterFn).toContain(step);
    }
    expect(body.slice(respondAt)).toContain('void afterResponse()');
  });
});

describe('GET /matches/:id/mvp computes on demand', () => {
  const mf = fs.readFileSync(path.join(__dirname, '../controllers/matchFeatures.controller.ts'), 'utf8');
  const fn = mf.slice(mf.indexOf('export async function getMatchMVP'));
  test('a completed match without an MVP yet gets one computed, once per process', () => {
    expect(fn).toMatch(/status === 'completed' && !match\.mvp_user_id[\s\S]{0,80}!mvpTried\.has\(id\)[\s\S]{0,200}calculateAndSetMVP\(id\)/);
  });
});
