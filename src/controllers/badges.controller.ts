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

  const { data: earned } = await supabase
    .from('user_badges')
    .select('badge_id')
    .eq('user_id', userId);
  const earnedIds = new Set((earned || []).map((e) => e.badge_id));

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

  let postCount = 0;
  if (needs('community')) {
    const { count } = await supabase
      .from('community_posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', userId);
    postCount = count ?? 0;
  }

  let followCount = 0;
  if (needs('general', 'social_butterfly')) {
    const { count } = await supabase
      .from('follow_relationships')
      .select('id', { count: 'exact', head: true })
      .eq('follower_id', userId);
    followCount = count ?? 0;
  }

  let giftCount = 0;
  if (needs('general', 'gift_giver')) {
    const { count } = await supabase
      .from('gift_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('sender_id', userId);
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

  if (newAwards.length > 0) {
    await supabase
      .from('user_badges')
      .upsert(newAwards, { onConflict: 'user_id,badge_id', ignoreDuplicates: true });
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
