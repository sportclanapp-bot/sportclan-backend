import { Router } from 'express';
import {
  getMe,
  getUserById,
  updateMe,
  updateAccountTypes,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  blockUser,
  unblockUser,
  getBlockedUsers,
  getProfileCompleteness,
  discoverPlayers,
  getSportProfile,
  updateSportProfile,
  getActivityHeatmap,
  getRival,
  getRatingHistory,
  getReviews,
  submitReview,
  deleteReview,
  checkIn,
} from '../controllers/users.controller';
import { getSeasonRecap } from '../controllers/features.controller';
import { getUserInsights } from '../controllers/insights.controller';
import { getAdvancedStats } from '../controllers/advancedStats.controller';
import { authenticateToken, optionalAuth } from '../middleware/auth.middleware';

const router = Router();

// Self routes — must be declared before /:id so they don't get captured.
router.get('/me', authenticateToken, getMe);
router.patch('/me', authenticateToken, updateMe);
router.patch('/me/account-types', authenticateToken, updateAccountTypes);
router.post('/me/check-in', authenticateToken, checkIn);
router.get('/me/blocked', authenticateToken, getBlockedUsers);
router.get('/me/profile-completeness', authenticateToken, getProfileCompleteness);
// SC-275: Advanced Stats (PREMIUM-gated inside the handler). Additive only —
// this is the sole new fence; no existing read is gated.
router.get('/me/advanced-stats', authenticateToken, getAdvancedStats);
// SC-325: a premium viewer can scout ANOTHER player's advanced stats. Registered
// AFTER /me/advanced-stats so the literal 'me' wins; the gate is on the VIEWER.
router.get('/:id/advanced-stats', authenticateToken, getAdvancedStats);
router.get('/discover', authenticateToken, discoverPlayers);

router.get('/:id', optionalAuth, getUserById);
router.get('/:id/followers', optionalAuth, getFollowers);
router.get('/:id/following', optionalAuth, getFollowing);
router.get('/:id/sport-profile/:sportId', getSportProfile);
router.patch('/:id/sport-profile/:sportId', authenticateToken, updateSportProfile);
router.get('/:id/activity-heatmap', getActivityHeatmap);
router.get('/:id/rating-history', authenticateToken, getRatingHistory);
router.get('/:id/rival', authenticateToken, getRival);
router.get('/:id/season-recap', getSeasonRecap);
router.get('/:id/insights', getUserInsights);

router.get('/:id/reviews', optionalAuth, getReviews);
router.post('/:id/reviews', authenticateToken, submitReview);
router.delete('/:id/reviews', authenticateToken, deleteReview);

router.post('/:id/follow', authenticateToken, followUser);
router.delete('/:id/follow', authenticateToken, unfollowUser);

router.post('/:id/block', authenticateToken, blockUser);
router.delete('/:id/block', authenticateToken, unblockUser);

export default router;
