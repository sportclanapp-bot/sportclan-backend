/**
 * Decisions 2026-09-26 (MATCH_CREATE_TEST_5, K3): End during an unfinished chase
 * awarded it to the side with more runs — "S1 Cricket XII won by 16 runs" with
 * 23 balls and ten wickets left. completeMatch now refuses a cricket match that
 * has started and is not over unless the scorer chose how it ends; the stage
 * rule is the shared cricketRules.cricketStage (fixture table in
 * cricketUnfinished.unit.test.ts, identical in the app).
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
const start = src.indexOf('export async function completeMatch');
const body = src.slice(start, src.indexOf('\nexport ', start + 10));

describe('completeMatch · an unfinished cricket match', () => {
  const rule = body.slice(body.indexOf('let awarded = false;'), body.indexOf('// F-17: a chess game ends with a result.'));
  test('is judged by the shared stage rule, only once play has started', () => {
    expect(rule).toContain("if (!walkover && !submittedSummary && normSportSlug(sportRow?.slug) === 'cricket')");
    expect(rule).toContain('if (a.balls + b.balls + a.runs + b.runs + a.wickets + b.wickets > 0)');
    expect(rule).toContain('const stage = cricketStage({');
    expect(rule).toContain('chaseAllOut: allOut[firstSide === \'A\' ? \'B\' : \'A\']');
  });
  test('needs a choice, a DLS target for a DLS end, and the right side for an award', () => {
    expect(rule).toContain("code: 'MATCH_NOT_OVER'");
    expect(rule).toContain("if (unfinishedEnd === 'dls' && (stage !== 'chase' || !dlsTarget))");
    expect(rule).toContain("code: 'DLS_TARGET_REQUIRED'");
    expect(rule).toContain("if (unfinishedEnd === 'award' && !awardAllowed(stage, winnerSide, firstSide))");
    expect(rule).toContain("code: 'AWARD_WRONG_SIDE'");
  });
  test('an award is not overruled by the DLS check, and reads "X won (awarded)"', () => {
    expect(body).toContain("if (!walkover && unfinishedEnd !== 'award' && normSportSlug(sportRow?.slug) === 'cricket' && (canonical?.dls_applied");
    expect(body).toContain('ss.result = `${derivedSide === \'A\' ? aName : bName} won (awarded)`;');
    expect(body).toContain('ss.awarded = true;');
  });
  test('the rule runs before anything is written', () => {
    expect(body.indexOf("code: 'MATCH_NOT_OVER'")).toBeLessThan(body.indexOf("await supabase.from('matches').update(patch).eq('id', id);"));
  });
  test('overs are read with the match', () => {
    expect(body).toMatch(/score_summary, toss_choice, format, overs(, voided_at)?'\)/);
  });
});
