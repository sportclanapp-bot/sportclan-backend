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
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

// SC-356 · profile posts. Audit #7 (11 Oct 2026): reads need sign-in too (no public pages); they
// resolve per-viewer state (is_liked, block filtering).
router.get('/', authenticateToken, listProfilePosts); // audit #7: sign-in only
router.get('/:id', authenticateToken, getProfilePost); // audit #7
router.get('/:id/comments', authenticateToken, listProfilePostComments); // audit #7

router.post('/', authenticateToken, createProfilePost);
router.patch('/:id', authenticateToken, updateProfilePost);
router.delete('/:id', authenticateToken, deleteProfilePost);
router.post('/:id/like', authenticateToken, likeProfilePost);
router.delete('/:id/like', authenticateToken, unlikeProfilePost);
router.post('/:id/comments', authenticateToken, addProfilePostComment);
router.delete('/comments/:commentId', authenticateToken, deleteProfilePostComment);

export default router;
