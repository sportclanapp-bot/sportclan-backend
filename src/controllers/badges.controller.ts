import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// GET /users/:id/badges — list badges for a user
export async function getUserBadges(req: Request, res: Response) {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('user_badges')
    .select(`
      id,
      awarded_at,
      badge:badge_id (id, slug, name, description, emoji, category)
    `)
    .eq('user_id', id)
    // Soft revoke (migration 098): a badge taken back by a void keeps its row
    // with revoked_at set; it is not earned while that is set.
    .is('revoked_at', null)
    .order('awarded_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Also fetch all badges so frontend can show locked vs unlocked
  const { data: allBadges } = await supabase
    .from('badges')
    .select('id, slug, name, description, emoji, category, threshold')
    .order('category')
    .order('threshold');

  const earnedIds = new Set((data || []).map((ub: any) => (ub.badge as any)?.id).filter(Boolean));

  const badges = (allBadges || []).map((b) => ({
    ...b,
    earned: earnedIds.has(b.id),
    awarded_at: (data || []).find((ub: any) => (ub.badge as any)?.id === b.id)?.awarded_at ?? null,
  }));

  return res.json({ badges });
}

// ── Core evaluator (SC-316) ──────────────────────────────────────────────────
// Pure userId → award logic, so it can run from the HTTP handler AND from the
// post-match / post-creation / follow / gift / tournament-entry fan-outs. Only
// the v1 badge set is auto-awardable:
//   • matches / wins / community  — the 6 general milestones (aggregate counts)
//   • general (BY SLUG)           — the 3 easy social badges we already count:
//        social_butterfly (follow 50), gift_giver (gift 20),
//        tournament_veteran (10 tournaments)
// Sport-specific badges (cricket/badminton/football/chess categories) and
// comeback_player need per-match event analysis → left locked until purpose-built.
// Idempotent: skips already-earned + upserts on the (user_id, badge_id) unique
// key, so concurrent fan-outs can't double-insert.
export async function evaluateBadgesForUser(
  userId: string,
): Promise<{ awarded: number; badges: Array<{ slug?: string; category?: string }> }> {
  const { data: allBadges } = await supabase
    .from('badges')
    .select('id, slug, category, threshold');
  if (!allBadges || allBadges.length === 0) return { awarded: 0, badges: [] };

  // Soft revoke (migration 098): a revoked row is not earned, but it still
  // holds the (user_id, badge_id) key — so re-earning it clears revoked_at on
  // that row instead of inserting a second one.
  const { data: rows } = await supabase
    .from('user_badges')
    .select('badge_id, revoked_at')
    .eq('user_id', userId);
  const earnedIds = new Set((rows || []).filter((e) => !e.revoked_at).map((e) => e.badge_id));
  const revokedIds = new Set((rows || []).filter((e) => !!e.revoked_at).map((e) => e.badge_id));

  const pending = allBadges.filter((b) => !earnedIds.has(b.id));
  if (pending.length === 0) return { awarded: 0, badges: [] };

  // Only fetch the stats a still-unearned badge actually needs — so once a user
  // has earned everything the hot-path hook does a single cheap read.
  const needs = (cat: string, slug?: string) =>
    pending.some((b) => b.category === cat && (!slug || b.slug === slug));

  let totalMatches = 0;
  let totalWins = 0;
  if (needs('matches') || needs('wins')) {
    const { data: sp } = await supabase
      .from('user_sport_profiles')
      .select('matches_played, wins')
      .eq('user_id', userId);
    totalMatches = (sp || []).reduce((s, p) => s + (p.matches_played ?? 0), 0);
    totalWins = (sp || []).reduce((s, p) => s + (p.wins ?? 0), 0);
  }

  // SC-396: these thresholds decide whether a user is AWARDED a badge. Each
  // query discarded its error and fell back to `?? 0`, so a transient failure
  // silently read as "you have posted nothing / follow nobody / sent no gifts"
  // and denied a badge the user had actually earned — the discarded-error →
  // plausible-zero class, with a user-visible consequence.
  //
  // On any failure we abort the whole evaluation and leave badge state
  // untouched. Awarding on partial data is as wrong as denying on it, and
  // badges are re-evaluated from five different hooks (SC-316), so skipping a
  // run is self-healing.
  let statsFailed = false;

  let postCount = 0;
  if (needs('community')) {
    const { count, error: e1 } = await supabase
      .from('community_posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', userId);
    if (e1) statsFailed = true;
    postCount = count ?? 0;
  }

  let followCount = 0;
  if (needs('general', 'social_butterfly')) {
    const { count, error: e2 } = await supabase
      .from('follow_relationships')
      .select('id', { count: 'exact', head: true })
      .eq('follower_id', userId);
    if (e2) statsFailed = true;
    followCount = count ?? 0;
  }

  let giftCount = 0;
  if (needs('general', 'gift_giver')) {
    const { count, error: e3 } = await supabase
      .from('gift_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('sender_id', userId);
    if (e3) statsFailed = true;
    giftCount = count ?? 0;
  }

  let tournamentCount = 0;
  if (needs('general', 'tournament_veteran')) {
    // A user "participates" via any team they're on that entered a tournament.
    const { data: tms } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId);
    const teamIds = (tms || []).map((t) => t.team_id);
    if (teamIds.length > 0) {
      const { data: entries } = await supabase
        .from('tournament_entries')
        .select('tournament_id')
        .in('team_id', teamIds)
        .eq('status', 'approved');
      tournamentCount = new Set((entries || []).map((e) => e.tournament_id)).size;
    }
  }

  const newAwards: Array<{ user_id: string; badge_id: string }> = [];
  // SC-396: a threshold query failed — evaluate nothing rather than award or
  // deny on incomplete counts. The next hook re-runs this.
  if (statsFailed) return { awarded: 0, badges: [] };

  for (const badge of pending) {
    let qualifies = false;
    switch (badge.category) {
      case 'matches':
        qualifies = totalMatches >= badge.threshold;
        break;
      case 'wins':
        qualifies = totalWins >= badge.threshold;
        break;
      case 'community':
        qualifies = postCount >= badge.threshold;
        break;
      case 'general':
        if (badge.slug === 'social_butterfly') qualifies = followCount >= badge.threshold;
        else if (badge.slug === 'gift_giver') qualifies = giftCount >= badge.threshold;
        else if (badge.slug === 'tournament_veteran') qualifies = tournamentCount >= badge.threshold;
        // comeback_player + unknown general slugs stay locked (v1 scope).
        break;
      // sport-specific categories: deferred (need per-event analysis).
    }
    if (qualifies) newAwards.push({ user_id: userId, badge_id: badge.id });
  }

  const restores = newAwards.filter((a) => revokedIds.has(a.badge_id)).map((a) => a.badge_id);
  const inserts = newAwards.filter((a) => !revokedIds.has(a.badge_id));
  if (restores.length > 0) {
    await supabase
      .from('user_badges')
      .update({ revoked_at: null, revoke_reason: null })
      .eq('user_id', userId)
      .in('badge_id', restores);
  }
  if (inserts.length > 0) {
    await supabase
      .from('user_badges')
      .upsert(inserts, { onConflict: 'user_id,badge_id', ignoreDuplicates: true });
  }

  return {
    awarded: newAwards.length,
    badges: newAwards.map((a) => {
      const badge = allBadges.find((b) => b.id === a.badge_id);
      return { slug: badge?.slug, category: badge?.category };
    }),
  };
}

// POST /badges/evaluate/:userId — evaluate and award any new badges
export async function evaluateBadges(req: Request, res: Response) {
  const userId = req.params.userId;

  // SC-101: only allow a user to evaluate their OWN badges (closes cross-user write).
  if (userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  try {
    const result = await evaluateBadgesForUser(userId);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Could not evaluate badges' });
  }
}

// V042 (visual review, decision D6): badges were only ever INSERTED. Voiding a
// match walks back matches_played / wins, but the First Match / Veteran /
// Winner / Champion rows it had earned stayed, so a player with 0 matches showed
// "4/21 earned". This is the other half of evaluateBadgesForUser, for the only
// two categories a void can move: a matches/wins badge whose threshold the
// profile totals no longer meet is removed. Silent, by decision — no
// notification. Restoring the match re-awards through awardBadgesSafe.
//
// Aborts on any read error (the SC-396 rule): revoking on a failed read would
// take away badges that are still earned.
export async function revokeRecordBadgesForUser(userId: string): Promise<{ revoked: number }> {
  const { data: recordBadges, error: e1 } = await supabase
    .from('badges')
    .select('id, category, threshold')
    .in('category', ['matches', 'wins']);
  if (e1 || !recordBadges || recordBadges.length === 0) return { revoked: 0 };

  const { data: sp, error: e2 } = await supabase
    .from('user_sport_profiles')
    .select('matches_played, wins')
    .eq('user_id', userId);
  if (e2) return { revoked: 0 };
  const totalMatches = (sp || []).reduce((s, p) => s + (p.matches_played ?? 0), 0);
  const totalWins = (sp || []).reduce((s, p) => s + (p.wins ?? 0), 0);

  const stale = recordBadges
    .filter((b) => (b.category === 'matches' ? totalMatches : totalWins) < b.threshold)
    .map((b) => b.id);
  if (stale.length === 0) return { revoked: 0 };

  // SOFT revoke (decided 27 Sep 2026 — no hard deletes of user data): the row
  // stays, marked revoked, and a restore clears the mark.
  const { data: revoked, error: e3 } = await supabase
    .from('user_badges')
    .update({ revoked_at: new Date().toISOString(), revoke_reason: 'match voided' })
    .eq('user_id', userId)
    .in('badge_id', stale)
    .is('revoked_at', null)
    .select('id');
  if (e3) return { revoked: 0 };
  return { revoked: revoked?.length ?? 0 };
}

/** Best-effort revoke for the void path. NEVER throws, like awardBadgesSafe. */
export async function revokeRecordBadgesSafe(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await revokeRecordBadgesForUser(userId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[badges] revoke failed for', userId, e instanceof Error ? e.message : e);
  }
}

// SC-316: best-effort award for the fan-out hooks (match completion, post
// creation, follow, gift, tournament entry). NEVER throws — a badge failure
// must not fail the action that triggered it.
export async function awardBadgesSafe(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await evaluateBadgesForUser(userId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[badges] award failed for', userId, e instanceof Error ? e.message : e);
  }
}
