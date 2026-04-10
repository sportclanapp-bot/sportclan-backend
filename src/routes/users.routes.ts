import { Router } from 'express';
import {
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
} from '../controllers/users.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Self routes — must be declared before /:id so they don't get captured.
router.patch('/me', authenticateToken, updateMe);
router.get('/me/blocked', authenticateToken, getBlockedUsers);
router.get('/me/profile-completeness', authenticateToken, getProfileCompleteness);
router.get('/discover', authenticateToken, discoverPlayers);

router.get('/:id', getUserById);
router.get('/:id/followers', getFollowers);
router.get('/:id/following', getFollowing);

router.post('/:id/follow', authenticateToken, followUser);
router.delete('/:id/follow', authenticateToken, unfollowUser);

router.post('/:id/block', authenticateToken, blockUser);
router.delete('/:id/block', authenticateToken, unblockUser);

export default router;
