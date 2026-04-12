"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dev_controller_1 = require("../controllers/dev.controller");
const features_controller_1 = require("../controllers/features.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// POST /dev/load-full-data — comprehensive test-data seeder.
// Remove before the production Store build.
router.post('/load-full-data', auth_middleware_1.authenticateToken, dev_controller_1.loadFullData);
// Trigger scheduled jobs manually for testing
router.get('/trigger-smart-match-notifications', auth_middleware_1.authenticateToken, features_controller_1.triggerSmartMatchNotifications);
router.get('/trigger-reengagement', auth_middleware_1.authenticateToken, features_controller_1.triggerReEngagement);
router.get('/trigger-weekly-digest', auth_middleware_1.authenticateToken, features_controller_1.triggerWeeklyDigest);
router.get('/publish-scheduled-posts', auth_middleware_1.authenticateToken, features_controller_1.publishScheduledPosts);
exports.default = router;
//# sourceMappingURL=dev.routes.js.map