/**
 * SC-442 (M5/D3) · the server enforces the 7-day void window.
 *
 * The app hides the button and says the deadline, but the server is what makes
 * it true — an old build, or a direct call, must be refused the same way.
 */
import { voidDeadline, withinVoidWindow, VOID_WINDOW_DAYS } from '../controllers/matches.controller';

const DAY = 24 * 3600_000;
const now = Date.parse('2026-09-23T12:00:00.000Z');
const ended = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

describe('SC-442 · server void window', () => {
  test('seven days, matching the app', () => {
    expect(VOID_WINDOW_DAYS).toBe(7);
  });

  test('unfinished matches are unbounded', () => {
    expect(withinVoidWindow({ status: 'live', updated_at: ended(400) }, now)).toBe(true);
    expect(voidDeadline({ status: 'scheduled', updated_at: ended(1) })).toBeNull();
  });

  test('completed and abandoned matches close after the window', () => {
    expect(withinVoidWindow({ status: 'completed', updated_at: ended(6) }, now)).toBe(true);
    expect(withinVoidWindow({ status: 'completed', updated_at: ended(8) }, now)).toBe(false);
    expect(withinVoidWindow({ status: 'abandoned', updated_at: ended(8) }, now)).toBe(false);
  });

  test('a missing timestamp fails OPEN, so no match is stranded uncorrectable', () => {
    expect(withinVoidWindow({ status: 'completed' }, now)).toBe(true);
    expect(withinVoidWindow({ status: 'completed', updated_at: 'not-a-date' }, now)).toBe(true);
  });

  test('the deadline is exactly the window past the end', () => {
    const d = voidDeadline({ status: 'completed', updated_at: ended(0) });
    expect(d?.toISOString()).toBe(new Date(now + VOID_WINDOW_DAYS * DAY).toISOString());
  });
});

describe('SC-442 · the handler wires it in the right order', () => {
  // The refusal must come after the permission check — so a stranger learns
  // nothing about timing — and before any write, so it changes nothing.
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8',
  );
  const body = (() => {
    const start = src.indexOf('export async function voidMatch');
    const next = src.indexOf('\nexport ', start + 10);
    return src.slice(start, next === -1 ? undefined : next);
  })();

  test('permission first, then the window, then the write', () => {
    const perm = body.indexOf('canVoidMatch');
    const window = body.indexOf('VOID_WINDOW_CLOSED');
    const write = body.indexOf('voided_at: new Date()');
    expect(perm).toBeGreaterThan(-1);
    expect(window).toBeGreaterThan(perm);
    expect(write).toBeGreaterThan(window);
  });

  test('both teams are told, on void and on restore', () => {
    expect(src).toContain("type: 'match_voided'");
    expect(src).toContain("type: 'match_restored'");
    // matchAudienceIds is participants + both teams' members.
    expect(body).toContain('matchAudienceIds(id, match.team_a_id, match.team_b_id)');
  });

  test('a notification failure cannot undo a completed void', () => {
    const tail = body.slice(body.indexOf("type: 'match_voided'"));
    expect(tail).toMatch(/catch \{/);
  });
});

describe('U-37 · the window runs from completion, not the last write', () => {
  test('completed_at wins over a later updated_at', () => {
    // A void and a restore each bumped updated_at, restarting the seven days.
    const m = { status: 'completed', completed_at: ended(8), updated_at: ended(0) };
    expect(withinVoidWindow(m, now)).toBe(false);
    expect(voidDeadline(m)?.toISOString())
      .toBe(new Date(Date.parse(ended(8)) + VOID_WINDOW_DAYS * DAY).toISOString());
  });

  test('an abandoned match, which has no completed_at, falls back to updated_at', () => {
    expect(withinVoidWindow({ status: 'abandoned', completed_at: null, updated_at: ended(3) }, now)).toBe(true);
    expect(withinVoidWindow({ status: 'abandoned', completed_at: null, updated_at: ended(9) }, now)).toBe(false);
  });

  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const fn = (name: string) => {
    const start = src.indexOf(`export async function ${name}`);
    const next = src.indexOf('\nexport ', start + 10);
    return src.slice(start, next === -1 ? undefined : next);
  };

  test('neither void nor restore writes updated_at', () => {
    for (const name of ['voidMatch', 'unvoidMatch']) {
      const body = fn(name);
      expect(body.length).toBeGreaterThan(100);
      expect(body).not.toMatch(/updated_at:\s*new Date\(\)/);
    }
  });

  test('the void handler reads completed_at, so the window can use it', () => {
    expect(fn('voidMatch')).toMatch(/\.select\('[^']*completed_at[^']*'\)/);
  });
});
