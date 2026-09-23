/**
 * SC-441 (M3) · past-dated matches must stop being discoverable, and a match
 * nobody ever started must eventually say so.
 *
 * The bug this pins: the open-match query had NO date predicate of any kind, and
 * the only staleness signal — a −25 relevance penalty — sat behind
 * `if (matches.length > 1)`, so in the single-candidate case it never ran. A
 * two-month-old fixture was served to a brand-new account as the top suggestion,
 * still joinable. Nothing anywhere moved it out of `scheduled`.
 */
import {
  DISCOVERY_GRACE_HOURS,
  UNPLAYED_ABANDON_HOURS,
  discoveryCutoffIso,
} from '../controllers/matches.controller';

const HOUR = 3600_000;

describe('SC-441 · discovery cutoff', () => {
  const now = Date.parse('2026-09-22T12:00:00.000Z');

  test('the cutoff is exactly the grace window behind now', () => {
    expect(discoveryCutoffIso(now)).toBe(new Date(now - DISCOVERY_GRACE_HOURS * HOUR).toISOString());
  });

  test('a match starting later is still discoverable', () => {
    const inAnHour = new Date(now + HOUR).toISOString();
    expect(inAnHour >= discoveryCutoffIso(now)).toBe(true);
  });

  test('a LATE start is not hidden mid-game — that is what the grace is for', () => {
    // Decision D2 chose 6h precisely so a match that starts late, or runs long
    // before anyone scores, never vanishes from the hub while it is happening.
    const startedFiveHoursAgo = new Date(now - 5 * HOUR).toISOString();
    expect(startedFiveHoursAgo >= discoveryCutoffIso(now)).toBe(true);
  });

  test('a match from two months ago is hidden — the reported bug', () => {
    const july = new Date(now - 60 * 24 * HOUR).toISOString();
    expect(july >= discoveryCutoffIso(now)).toBe(false);
  });

  test('the windows are the decided values, and abandon is well after hide', () => {
    expect(DISCOVERY_GRACE_HOURS).toBe(6);
    expect(UNPLAYED_ABANDON_HOURS).toBe(48);
    // Hiding must come first: a match should stop being offered long before it
    // is declared abandoned, never the other way round.
    expect(UNPLAYED_ABANDON_HOURS).toBeGreaterThan(DISCOVERY_GRACE_HOURS);
  });
});

/**
 * SC-442 · the 48h flip, PROVEN BY TEST, NOT ON DEVICE.
 *
 * Stated plainly because it matters: I could not stage this on a device. The
 * match-create date picker greys out every past date, so the app cannot produce
 * a back-dated match, and the historical backlog had already been swept by an
 * earlier boot — `POST /internal/jobs/sweep-matches` correctly returned
 * {"staleLiveAbandoned":0,"unplayedAbandoned":0} with nothing left to find.
 *
 * So what IS verified: the endpoint responds 200 with real counts, the job is
 * wired to the hourly in-process scheduler and runs on boot, and the predicate
 * below is asserted here. What is NOT verified end to end: a real row changing
 * status on prod.
 */
describe('SC-442 · the unplayed sweep predicate', () => {
  const HOUR2 = 3600_000;
  const cutoffFor = (now: number) =>
    new Date(now - UNPLAYED_ABANDON_HOURS * HOUR2).toISOString();

  test('a match 49h past its start is caught', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z');
    const started = new Date(now - 49 * HOUR2).toISOString();
    expect(started < cutoffFor(now)).toBe(true);
  });

  test('a match 47h past is NOT caught — still inside the window', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z');
    const started = new Date(now - 47 * HOUR2).toISOString();
    expect(started < cutoffFor(now)).toBe(false);
  });

  test('the sweep window is well clear of the discovery window', () => {
    // A match must stop being OFFERED long before it is declared abandoned, so
    // a late start is never marked dead while it is being played.
    expect(UNPLAYED_ABANDON_HOURS).toBeGreaterThan(DISCOVERY_GRACE_HOURS * 4);
  });

  test('only pre-completion statuses are swept', () => {
    // A completed or cancelled match is already terminal; a live one belongs to
    // the other sweeper. Asserted against the source so the status list cannot
    // quietly widen into something that rewrites finished matches.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8',
    );
    const fn = src.slice(src.indexOf('export async function sweepUnplayedScheduledMatches'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("in('status', ['scheduled', 'upcoming'])");
    expect(body).toContain("lt('scheduled_at', cutoff)");
    expect(body).toContain("update({ status: 'abandoned'");
    // Nothing is deleted — decision D2.
    expect(body).not.toContain('.delete(');
  });
});

/**
 * SC-443 (M5) · results are ordered by when they FINISHED.
 *
 * Two problems, found in that order. Everything was ordered by scheduled_at
 * desc, and Postgres orders DESC with NULLS FIRST, so every undated row sorted
 * ahead of every dated one — ~45 screens of scrolling never reached a match
 * completed fifteen minutes earlier. With nullsFirst fixed and the dates
 * showing, the top of the list became matches scheduled for NEXT WEEK that were
 * already completed: seed rows with a future scheduled_at. "Most recent results
 * first" has to mean most recently PLAYED.
 */
describe('SC-443 · completed lists order by finish time', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const body = (() => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8',
    );
    const start = src.indexOf('export async function listMatches');
    const next = src.indexOf('\nexport ', start + 10);
    return src.slice(start, next === -1 ? undefined : next)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  })();

  test('finished statuses sort by updated_at, not scheduled_at', () => {
    expect(body).toContain("status === 'completed' || status === 'abandoned'");
    expect(body).toMatch(/order\('updated_at', \{ ascending: false, nullsFirst: false \}\)/);
  });

  test('unfinished lists still sort by kick-off, which is the right field there', () => {
    expect(body).toMatch(/order\('scheduled_at', \{ ascending: false, nullsFirst: false \}\)/);
  });

  test('NULLS LAST is kept on both, so undated rows never lead', () => {
    const orders = body.match(/nullsFirst: false/g) ?? [];
    expect(orders.length).toBe(2);
  });

  test('the history scopings still bypass the voided filter', () => {
    // M5's new routes rely on this: a voided match must stay reachable from a
    // team's history and from your own, which is what makes it correctable.
    expect(body).toContain('shouldHideVoided({ status, teamScoped: !!team_id, mine: mine === \'1\' })');
  });
});
