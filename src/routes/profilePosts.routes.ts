import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import {
  createProfilePost,
  listProfilePosts,
  getProfilePost,
  updateProfilePost,
  deleteProfilePost,
  likeProfilePost,
  unlikeProfilePost,
  listProfilePostComments,
  addProfilePostComment,
  deleteProfilePostComment,
} from '../controllers/profilePosts.controller';
import { authenticateToken, optionalAuth } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

// SC-356 · profile posts. Reads use optionalAuth so a wall is viewable while
// still resolving per-viewer state (is_liked, block filtering) when signed in.
router.get('/', optionalAuth, listProfilePosts);
router.get('/:id', optionalAuth, getProfilePost);
router.get('/:id/comments', optionalAuth, listProfilePostComments);

router.post('/', authenticateToken, createProfilePost);
router.patch('/:id', authenticateToken, updateProfilePost);
router.delete('/:id', authenticateToken, deleteProfilePost);
router.post('/:id/like', authenticateToken, likeProfilePost);
router.delete('/:id/like', authenticateToken, unlikeProfilePost);
router.post('/:id/comments', authenticateToken, addProfilePostComment);
router.delete('/comments/:commentId', authenticateToken, deleteProfilePostComment);

export default router;
