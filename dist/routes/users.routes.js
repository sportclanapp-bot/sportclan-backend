"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const users_controller_1 = require("../controllers/users.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Self routes — must be declared before /:id so they don't get captured.
router.get('/me', auth_middleware_1.authenticateToken, users_controller_1.getMe);
router.patch('/me', auth_middleware_1.authenticateToken, users_controller_1.updateMe);
router.get('/me/blocked', auth_middleware_1.authenticateToken, users_controller_1.getBlockedUsers);
router.get('/me/profile-completeness', auth_middleware_1.authenticateToken, users_controller_1.getProfileCompleteness);
router.get('/discover', auth_middleware_1.authenticateToken, users_controller_1.discoverPlayers);
router.get('/:id', users_controller_1.getUserById);
router.get('/:id/followers', users_controller_1.getFollowers);
router.get('/:id/following', users_controller_1.getFollowing);
router.get('/:id/sport-profile/:sportId', users_controller_1.getSportProfile);
router.get('/:id/activity-heatmap', users_controller_1.getActivityHeatmap);
router.get('/:id/rival', auth_middleware_1.authenticateToken, users_controller_1.getRival);
router.post('/:id/follow', auth_middleware_1.authenticateToken, users_controller_1.followUser);
router.delete('/:id/follow', auth_middleware_1.authenticateToken, users_controller_1.unfollowUser);
router.post('/:id/block', auth_middleware_1.authenticateToken, users_controller_1.blockUser);
router.delete('/:id/block', auth_middleware_1.authenticateToken, users_controller_1.unblockUser);
exports.default = router;
//# sourceMappingURL=users.routes.js.map