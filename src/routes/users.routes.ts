import { Router } from 'express';
import {
  getMe,
  getUserById,
  updateMe,
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
} from '../controllers/users.controller';
import { getSeasonRecap } from '../controllers/features.controller';
import { getUserInsights } from '../controllers/insights.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Self routes — must be declared before /:id so they don't get captured.
router.get('/me', authenticateToken, getMe);
router.patch('/me', authenticateToken, updateMe);
router.get('/me/blocked', authenticateToken, getBlockedUsers);
router.get('/me/profile-completeness', authenticateToken, getProfileCompleteness);
router.get('/discover', authenticateToken, discoverPlayers);

router.get('/:id', getUserById);
router.get('/:id/followers', getFollowers);
router.get('/:id/following', getFollowing);
router.get('/:id/sport-profile/:sportId', getSportProfile);
router.patch('/:id/sport-profile/:sportId', authenticateToken, updateSportProfile);
router.get('/:id/activity-heatmap', getActivityHeatmap);
router.get('/:id/rating-history', authenticateToken, getRatingHistory);
router.get('/:id/rival', authenticateToken, getRival);
router.get('/:id/season-recap', getSeasonRecap);
router.get('/:id/insights', getUserInsights);

router.get('/:id/reviews', getReviews);
router.post('/:id/reviews', authenticateToken, submitReview);

router.post('/:id/follow', authenticateToken, followUser);
router.delete('/:id/follow', authenticateToken, unfollowUser);

router.post('/:id/block', authenticateToken, blockUser);
router.delete('/:id/block', authenticateToken, unblockUser);

export default router;
