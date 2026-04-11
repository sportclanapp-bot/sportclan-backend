"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notifications_controller_1 = require("../controllers/notifications.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/token', auth_middleware_1.authenticateToken, notifications_controller_1.savePushToken);
router.get('/', auth_middleware_1.authenticateToken, notifications_controller_1.listNotifications);
router.get('/digest', auth_middleware_1.authenticateToken, notifications_controller_1.weeklyDigest);
router.patch('/read-all', auth_middleware_1.authenticateToken, notifications_controller_1.markAllRead);
router.patch('/:id/read', auth_middleware_1.authenticateToken, notifications_controller_1.markRead);
router.delete('/:id', auth_middleware_1.authenticateToken, notifications_controller_1.deleteNotification);
exports.default = router;
//# sourceMappingURL=notifications.routes.js.map