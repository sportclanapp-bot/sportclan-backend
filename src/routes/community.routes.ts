import { Router } from 'express';
import {
  listPosts, getPost, createPost, updatePost, deletePost, closePost,
  likePost, unlikePost, checkLiked, votePoll,
  listComments, createComment, deleteComment, reactToComment,
  reportContent, getMyPostCount, searchMentions, getSportStoryCounts,
} from '../controllers/community.controller';
import { authenticateToken, optionalAuth } from '../middleware/auth.middleware';

const router = Router();

// Posts
router.get('/posts', authenticateToken, listPosts);
router.get('/posts/my-count', authenticateToken, getMyPostCount);
router.get('/sport-story-counts', authenticateToken, getSportStoryCounts);
router.get('/posts/:id', optionalAuth, getPost);
router.post('/posts', authenticateToken, createPost);
router.patch('/posts/:id', authenticateToken, updatePost);
router.delete('/posts/:id', authenticateToken, deletePost);
router.post('/posts/:id/close', authenticateToken, closePost);

// Likes
router.post('/posts/:id/like', authenticateToken, likePost);
router.delete('/posts/:id/like', authenticateToken, unlikePost);
router.get('/posts/:id/liked', authenticateToken, checkLiked);
router.post('/posts/:id/vote', authenticateToken, votePoll);

// Comments
router.get('/posts/:id/comments', optionalAuth, listComments);
router.post('/posts/:id/comments', authenticateToken, createComment);
router.delete('/comments/:commentId', authenticateToken, deleteComment);
router.post('/comments/:commentId/react', authenticateToken, reactToComment);

// Reports
router.post('/report', authenticateToken, reportContent);

// Mentions
router.get('/mentions', authenticateToken, searchMentions);

export default router;
