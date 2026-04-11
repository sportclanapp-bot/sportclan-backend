import { Router } from 'express';
import {
  listPosts, getPost, createPost, updatePost, deletePost, closePost,
  likePost, unlikePost, checkLiked,
  listComments, createComment, deleteComment, reactToComment,
  reportContent, getMyPostCount, searchMentions, getSportStoryCounts,
} from '../controllers/community.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Posts
router.get('/posts', listPosts);
router.get('/posts/my-count', authenticateToken, getMyPostCount);
router.get('/sport-story-counts', authenticateToken, getSportStoryCounts);
router.get('/posts/:id', getPost);
router.post('/posts', authenticateToken, createPost);
router.patch('/posts/:id', authenticateToken, updatePost);
router.delete('/posts/:id', authenticateToken, deletePost);
router.post('/posts/:id/close', authenticateToken, closePost);

// Likes
router.post('/posts/:id/like', authenticateToken, likePost);
router.delete('/posts/:id/like', authenticateToken, unlikePost);
router.get('/posts/:id/liked', authenticateToken, checkLiked);

// Comments
router.get('/posts/:id/comments', listComments);
router.post('/posts/:id/comments', authenticateToken, createComment);
router.delete('/comments/:commentId', authenticateToken, deleteComment);
router.post('/comments/:commentId/react', authenticateToken, reactToComment);

// Reports
router.post('/report', authenticateToken, reportContent);

// Mentions
router.get('/mentions', authenticateToken, searchMentions);

export default router;
