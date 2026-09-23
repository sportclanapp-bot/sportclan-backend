/**
 * B4 · B6 — the backend half.
 */
import fs from 'fs';
import path from 'path';
import { shouldGoLive, statusAfterFixtures, ymd } from '../utils/tournamentStatus';

const code = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NOW = new Date('2026-09-23T12:00:00Z');

// ─── F-52 · LIVE a week before it starts ────────────────────────────────────
describe('a tournament is live when it starts, not when it is drawn', () => {
  it('the reported case: drawn today, starts 29 Sep 2026', () => {
    expect(statusAfterFixtures('2026-09-29', NOW)).toBe('upcoming');
  });

  it('drawn on the day it starts → live', () => {
    expect(statusAfterFixtures('2026-09-23', NOW)).toBe('live');
  });

  it('drawn late → live', () => {
    expect(statusAfterFixtures('2026-09-01', NOW)).toBe('live');
  });

  it('no start date at all → live, as it always was', () => {
    // An organiser who drew fixtures without setting a date is starting now,
    // and this keeps pre-scheduling tournaments behaving as they did.
    expect(statusAfterFixtures(null, NOW)).toBe('live');
    expect(statusAfterFixtures(undefined, NOW)).toBe('live');
  });

  it('a full timestamp is compared by its date part', () => {
    expect(statusAfterFixtures('2026-09-23T23:59:00Z', NOW)).toBe('live');
  });

  it('ymd matches the DATE column it is compared against', () => {
    expect(ymd(NOW)).toBe('2026-09-23');
  });
});

describe('the sweep that starts it on the day', () => {
  const due = { status: 'upcoming', start_date: '2026-09-23' };

  it('starts a due tournament that has fixtures', () => {
    expect(shouldGoLive(due, true, NOW)).toBe(true);
  });

  it('will not start one whose draw was never made', () => {
    // Unstarted is not the same as live; flipping it swaps one wrong badge for
    // another.
    expect(shouldGoLive(due, false, NOW)).toBe(false);
  });

  it('will not touch one that is not upcoming', () => {
    for (const status of ['live', 'completed', 'cancelled']) {
      expect(shouldGoLive({ ...due, status }, true, NOW)).toBe(false);
    }
  });

  it('will not start one before its date', () => {
    expect(shouldGoLive({ ...due, start_date: '2026-09-24' }, true, NOW)).toBe(false);
  });

  it('is wired to the existing hourly scheduler, not a new service (D2)', () => {
    const index = code('index.ts');
    expect(index).toContain('sweepTournamentsDue()');
    expect(index).toContain('setInterval(runMatchSweeps, 60 * 60 * 1000)');
  });

  it('the write is idempotent — a second instance changes nothing', () => {
    const t = code('controllers/tournaments.controller.ts');
    const sweep = t.slice(t.indexOf('export async function sweepTournamentsDue'));
    expect(sweep).toContain(".eq('status', 'upcoming')");
  });

  it('generation no longer hard-codes live', () => {
    const t = code('controllers/tournaments.controller.ts');
    expect(t).not.toContain("update({ status: 'live' }).eq('id', id)");
    expect(t.match(/statusAfterFixtures\(tournament\.start_date/g)).toHaveLength(3);
  });
});

// ─── the 0-likes report + F-32 ──────────────────────────────────────────────
describe('one like notification per post, and it tells the truth', () => {
  const c = code('controllers/community.controller.ts');
  const sync = c.slice(c.indexOf('async function syncLikeNotification'), c.indexOf('function syncLikeNotificationAsync'));

  it('reads the live count instead of trusting a cache', () => {
    expect(sync).toContain("from('post_likes')");
    expect(sync).toContain("{ count: 'exact', head: true }");
  });

  it('deletes the notification when the last like is withdrawn', () => {
    // "A post shows 0 likes while a like notification for it exists" — the
    // notification simply outlived the like, because unlikePost did nothing.
    expect(sync).toContain('if (likes === 0)');
    expect(sync).toMatch(/from\('notifications'\)\s*\.delete\(\)/);
  });

  it('groups instead of stacking a row per like (F-32)', () => {
    expect(sync).toContain('others === 0');
    expect(sync).toContain('other${others === 1 ? \'\' : \'s\'} liked your post');
  });

  it('collapses rows an earlier build already piled up', () => {
    expect(sync).toContain('const [keep, ...dupes] = existing');
  });

  it('a new like re-raises it; an unlike only corrects the wording', () => {
    // Nothing should be marked unread to tell someone that LESS has happened.
    expect(sync).toContain('...(liked ? { read: false, created_at:');
  });

  it('creating the first one still runs every gate', () => {
    // Block, self, soft-deleted and notification preferences all live in
    // notifyUsers — the update path must not become a way around them.
    expect(sync).toContain('notifyEngagement(authorId, actorId');
  });

  it('unlikePost calls it — that is the actual fix', () => {
    const unlike = c.slice(c.indexOf('export async function unlikePost'));
    expect(unlike.slice(0, 900)).toContain('syncLikeNotificationAsync');
  });

  it('it stays off the response path (SC-112)', () => {
    expect(c).toContain('void syncLikeNotification(postId, authorId, actorId, liked).catch(');
  });
});

describe('the count caches cannot go negative any more', () => {
  const migRaw = fs.readFileSync(
    path.join(__dirname, '..', '..', 'supabase', 'migrations', '093_post_counts_floor.sql'), 'utf8');
  const mig = migRaw.replace(/^\s*--.*$/gm, '');

  it('both community_posts counters get the floor migration 075 already had', () => {
    expect(mig).toContain('GREATEST(likes_count - 1, 0)');
    expect(mig).toContain('GREATEST(comments_count - 1, 0)');
  });

  it('and corrects whatever has already drifted', () => {
    expect(mig).toMatch(/UPDATE community_posts[\s\S]*IS DISTINCT FROM/);
  });

  it('drops nothing', () => {
    expect(mig).not.toMatch(/\bDROP\b/i);
  });
});

// ─── F-58 · a decided request is not still waiting ──────────────────────────
describe('a resolved join request stops asking to be read', () => {
  const t = code('controllers/teams.controller.ts');

  it('marks it read rather than deleting it', () => {
    // The request genuinely happened, and the row is how a manager finds their
    // way back to the team. It just is not new any more.
    expect(t).toContain("update({ read: true })");
    expect(t).toContain("eq('type', 'team_join_requested')");
  });

  it('clears it for EVERY manager, not just the one who decided', () => {
    expect(t).toContain("eq('data->>teamId', teamId)");
    expect(t).toContain("eq('data->>requesterId', requesterId)");
  });

  it('on approve and decline alike', () => {
    const decide = t.slice(t.indexOf("update({ status, decided_by: userId"));
    expect(decide.slice(0, 600)).toContain('clearJoinRequestNotifications(id, targetUserId)');
  });

  it('and on a withdrawal — the same dead end from the other side', () => {
    const withdraw = t.slice(t.indexOf('export async function withdrawJoinRequest'));
    expect(withdraw).toContain('clearJoinRequestNotifications(id, userId)');
  });
});

// ─── F-17 · two welcome rows that read like one charged twice ───────────────
describe('the signup coin grants are told apart', () => {
  const a = code('controllers/auth.controller.ts');

  it('says which is which', () => {
    expect(a).toContain("'Early supporter bonus'");
    expect(a).toContain("'Signup bonus'");
    expect(a).not.toContain("'Welcome to SportClan'");
  });

  it('but does NOT rename the event keys', () => {
    // They are the idempotency keys on coin_events. Renaming one hands every
    // existing user a second grant the next time anything calls this.
    expect(a).toContain("'early_bird_grant'");
    expect(a).toContain("'first_registration'");
  });

  it('and still totals 60, on every signup path there is', () => {
    expect(a).toContain('const EARLY_BIRD_COINS = 50;');
    // ONE path. Google sign-in went first (never worked in production), then
    // the phone-less email signup (23 Sep 2026): a verified mobile is the only
    // recovery route this app has, so every account now starts with one. Email
    // + password ride on that same call as optional extras.
    expect(a.match(/'first_registration', 10,/g)?.length).toBe(1);
  });
});
