"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const community_controller_1 = require("../controllers/community.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Posts
router.get('/posts', community_controller_1.listPosts);
router.get('/posts/my-count', auth_middleware_1.authenticateToken, community_controller_1.getMyPostCount);
router.get('/sport-story-counts', auth_middleware_1.authenticateToken, community_controller_1.getSportStoryCounts);
router.get('/posts/:id', community_controller_1.getPost);
router.post('/posts', auth_middleware_1.authenticateToken, community_controller_1.createPost);
router.patch('/posts/:id', auth_middleware_1.authenticateToken, community_controller_1.updatePost);
router.delete('/posts/:id', auth_middleware_1.authenticateToken, community_controller_1.deletePost);
router.post('/posts/:id/close', auth_middleware_1.authenticateToken, community_controller_1.closePost);
// Likes
router.post('/posts/:id/like', auth_middleware_1.authenticateToken, community_controller_1.likePost);
router.delete('/posts/:id/like', auth_middleware_1.authenticateToken, community_controller_1.unlikePost);
router.get('/posts/:id/liked', auth_middleware_1.authenticateToken, community_controller_1.checkLiked);
// Comments
router.get('/posts/:id/comments', community_controller_1.listComments);
router.post('/posts/:id/comments', auth_middleware_1.authenticateToken, community_controller_1.createComment);
router.delete('/comments/:commentId', auth_middleware_1.authenticateToken, community_controller_1.deleteComment);
router.post('/comments/:commentId/react', auth_middleware_1.authenticateToken, community_controller_1.reactToComment);
// Reports
router.post('/report', auth_middleware_1.authenticateToken, community_controller_1.reportContent);
// Mentions
router.get('/mentions', auth_middleware_1.authenticateToken, community_controller_1.searchMentions);
exports.default = router;
//# sourceMappingURL=community.routes.js.map