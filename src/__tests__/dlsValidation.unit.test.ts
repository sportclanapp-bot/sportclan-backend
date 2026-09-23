/**
 * F-44 · the endpoint refuses a match that was never played.
 *
 * calculateDLSTarget's zero-resources guard returns "no reduction" so callers
 * never see a NaN. That is fine arithmetic and a dangerous answer: with a
 * Team-1 score of 0 over 0 overs it returns a revised target of 1, which the
 * app printed as a result. The guard stays; the endpoint now never reaches it
 * with nonsense.
 */
import { calculateDLSTarget, dlsInputProblem } from '../utils/dls';
import fs from 'fs';
import path from 'path';

const ok = { team1Score: 120, totalOvers: 20, team2OversLeft: 8, team2Wickets: 3 };

describe('dlsInputProblem', () => {
  it('passes a real interruption', () => {
    expect(dlsInputProblem(ok)).toBeNull();
  });

  it('refuses the exact input that produced "Revised target: 1"', () => {
    expect(dlsInputProblem({ team1Score: 0, totalOvers: 0, team2OversLeft: 0, team2Wickets: 0 }))
      .toBe('Total overs must be at least 1 — there is nothing to reduce from.');
  });

  it.each([
    [{ ...ok, totalOvers: 0 }, 'Total overs must be at least 1 — there is nothing to reduce from.'],
    [{ ...ok, team1Score: -1 }, "Team 1's score cannot be negative."],
    [{ ...ok, team2Wickets: 11 }, 'Wickets lost is between 0 and 10.'],
    [{ ...ok, team2Wickets: 10 }, 'Team 2 is all out — the innings is over, so there is no target to revise.'],
    [{ ...ok, team2OversLeft: -1 }, 'Overs remaining cannot be negative.'],
    [{ ...ok, team2OversLeft: 25 }, 'Team 2 cannot have more overs left than the match allows.'],
    [{ ...ok, team2OversLeft: 0 }, 'No overs remain — there is nothing left to chase in.'],
  ])('%o', (input, expected) => {
    expect(dlsInputProblem(input)).toBe(expected);
  });

  it('refuses NaN rather than passing it into the formula', () => {
    expect(dlsInputProblem({ ...ok, totalOvers: NaN })).toBe('Those are not all numbers.');
  });

  it('the wording matches the app’s, word for word', () => {
    // Two validators, one scorer. If these drift, the refusal changes shape
    // depending on whether the phone or the server said it.
    //
    // The app lives in a sibling repo, which is not always checked out beside
    // this one. Skipping is deliberate: a cross-repo assertion that FAILS when
    // the other repo is simply absent is a test people delete, and then nothing
    // watches the wording at all.
    const appFile = path.join(__dirname, '..', '..', '..', 'sportclan-v2', 'src', 'utils', 'dlsInput.ts');
    if (!fs.existsSync(appFile)) return;
    const app = fs.readFileSync(appFile, 'utf8');
    for (const msg of [
      'Total overs must be at least 1 — there is nothing to reduce from.',
      'Team 2 is all out — the innings is over, so there is no target to revise.',
      'Team 2 cannot have more overs left than the match allows.',
      'No overs remain — there is nothing left to chase in.',
      'Wickets lost is between 0 and 10.',
    ]) {
      expect(app).toContain(msg);
    }
  });
});

describe('the guard it protects is still there', () => {
  it('calculateDLSTarget still answers 1 for the impossible case', () => {
    // Unchanged on purpose: it exists to stop a NaN reaching the database, and
    // it is now unreachable from the endpoint. Deleting it would put the NaN
    // back for any other caller.
    expect(calculateDLSTarget(0, 0, 0, 0).revisedTarget).toBe(1);
  });

  it('and still reduces a real target proportionally', () => {
    const full = calculateDLSTarget(120, 20, 20, 0).revisedTarget;
    const rained = calculateDLSTarget(120, 20, 8, 3).revisedTarget;
    expect(rained).toBeLessThan(full);
    expect(rained).toBeGreaterThan(1);
  });
});

describe('the endpoint is wired to it', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'matchFeatures.controller.ts'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('applyDLS validates before it calculates', () => {
    const check = src.indexOf('dlsInputProblem(');
    const calc = src.indexOf('calculateDLSTarget(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(calc);
  });

  it('and answers 400 with a code, not a target', () => {
    expect(src).toContain("code: 'DLS_IMPOSSIBLE'");
  });
});
